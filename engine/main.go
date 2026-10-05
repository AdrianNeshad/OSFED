// Command osfed-engine is the OSFED data engine.
//
// It is a long-running sidecar that speaks newline-delimited JSON-RPC over
// stdin/stdout, driven by the Electron main process. Every line read from
// stdin is one request object {"id", "method", "params"}; every response is a
// single line {"id", "result"} or {"id", "error": {"message"}} written to the
// real stdout. One-way notifications {"method", "params"} (no id) are used for
// progress events.
//
// stdout is reserved exclusively for the RPC channel. Because the vendored
// github.com/dunhamsteve/ios packages occasionally print diagnostics with
// fmt.Println, we reassign os.Stdout to stderr at startup (mirroring the
// "stdout guard" OpenExtract's Python sidecar uses) and write RPC frames to a
// saved handle on the real stdout.
package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os"
	"runtime/debug"
	"sync"
)

// Version is the engine protocol/build version surfaced via ping.
const Version = "0.1.0"

// rpcOut is the real stdout, reserved for JSON-RPC frames.
var rpcOut io.Writer

// writeMu serializes writes to rpcOut so concurrent handlers/notifications
// never interleave bytes on the wire.
var writeMu sync.Mutex

type rpcRequest struct {
	ID     *json.RawMessage `json:"id"`
	Method string           `json:"method"`
	Params json.RawMessage  `json:"params"`
}

type rpcError struct {
	Message string `json:"message"`
}

type rpcResponse struct {
	ID     *json.RawMessage `json:"id"`
	Result interface{}      `json:"result,omitempty"`
	Error  *rpcError        `json:"error,omitempty"`
}

// handlerFunc handles one request. params is the raw params object; the
// returned value is JSON-marshaled into the result field.
type handlerFunc func(params json.RawMessage) (interface{}, error)

func main() {
	// ── stdout guard ────────────────────────────────────────────────────────
	rpcOut = os.Stdout
	os.Stdout = os.Stderr
	log.SetOutput(os.Stderr)
	log.SetFlags(0)

	eng := newEngine()
	handlers := eng.handlers()

	reader := bufio.NewReaderSize(os.Stdin, 1<<20)
	for {
		line, err := readLine(reader)
		if err == io.EOF {
			return
		}
		if err != nil {
			fmt.Fprintln(os.Stderr, "[engine] read error:", err)
			return
		}
		if len(line) == 0 {
			continue
		}

		var req rpcRequest
		if err := json.Unmarshal(line, &req); err != nil {
			fmt.Fprintln(os.Stderr, "[engine] bad request json:", err)
			continue
		}

		// Dispatch each request on its own goroutine so a slow extraction does
		// not block device-backup progress notifications or quick calls.
		go dispatch(handlers, req)
	}
}

func dispatch(handlers map[string]handlerFunc, req rpcRequest) {
	defer func() {
		if r := recover(); r != nil {
			// A panic in a vendored library (log.Fatal aside) must not take the
			// whole engine down — surface it as an error on this request.
			fmt.Fprintf(os.Stderr, "[engine] panic in %s: %v\n%s\n", req.Method, r, debug.Stack())
			sendError(req.ID, fmt.Sprintf("engine panic: %v", r))
		}
	}()

	h, ok := handlers[req.Method]
	if !ok {
		sendError(req.ID, "unknown method: "+req.Method)
		return
	}

	result, err := h(req.Params)
	if err != nil {
		sendError(req.ID, err.Error())
		return
	}
	sendResult(req.ID, result)
}

// readLine reads a single newline-terminated frame, tolerating very long lines
// (keychain / message payloads can be large).
func readLine(r *bufio.Reader) ([]byte, error) {
	var buf []byte
	for {
		chunk, isPrefix, err := r.ReadLine()
		if err != nil {
			return nil, err
		}
		buf = append(buf, chunk...)
		if !isPrefix {
			return buf, nil
		}
	}
}

func sendResult(id *json.RawMessage, result interface{}) {
	writeFrame(rpcResponse{ID: id, Result: result})
}

func sendError(id *json.RawMessage, msg string) {
	writeFrame(rpcResponse{ID: id, Error: &rpcError{Message: msg}})
}

// notify emits a one-way notification (no id) to the app.
func notify(method string, params interface{}) {
	raw, _ := json.Marshal(params)
	writeFrame(struct {
		Method string          `json:"method"`
		Params json.RawMessage `json:"params"`
	}{Method: method, Params: raw})
}

func writeFrame(v interface{}) {
	data, err := json.Marshal(v)
	if err != nil {
		fmt.Fprintln(os.Stderr, "[engine] marshal error:", err)
		return
	}
	writeMu.Lock()
	defer writeMu.Unlock()
	rpcOut.Write(data)
	rpcOut.Write([]byte{'\n'})
}
