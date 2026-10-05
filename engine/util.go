package main

import (
	"fmt"
	"os"
	"strings"
	"time"
	"unicode/utf8"
)

// dbg writes to stderr only when OSFED_DEBUG is set, so it never pollutes the
// RPC channel and is silent in normal use.
func dbg(format string, args ...interface{}) {
	if os.Getenv("OSFED_DEBUG") != "" {
		fmt.Fprintf(os.Stderr, "[osfed-dbg] "+format+"\n", args...)
	}
}

// containsFold reports whether substr is within s, case-insensitively.
func containsFold(s, substr string) bool {
	return strings.Contains(strings.ToLower(s), strings.ToLower(substr))
}

// bytesValue is the JSON shape used for any raw []byte pulled out of the
// keychain: a printable UTF-8 rendering when possible, plus hex/base64 so the
// UI can always fall back to a non-lossy representation.
type bytesValue struct {
	Bytes  bool   `json:"__bytes__"`
	Len    int    `json:"len"`
	UTF8   string `json:"utf8,omitempty"`
	Hex    string `json:"hex"`
	Base64 string `json:"base64"`
}

// isMostlyPrintable decides whether a byte slice reads as human text.
func isMostlyPrintable(b []byte) bool {
	if len(b) == 0 || !utf8.Valid(b) {
		return false
	}
	printable := 0
	for _, r := range string(b) {
		if r == '\n' || r == '\r' || r == '\t' || (r >= 0x20 && r != 0x7f) {
			printable++
		}
	}
	return printable*100 >= len(string(b))*90
}

// asRFC3339 formats a time as a stable ISO-8601 UTC string.
func asRFC3339(t time.Time) string {
	return t.UTC().Format(time.RFC3339)
}
