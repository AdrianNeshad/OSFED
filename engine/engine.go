package main

import (
	"encoding/json"
	"fmt"
	"sync"

	"github.com/dunhamsteve/ios/backup"
)

// session holds one opened (and possibly decrypted + loaded) backup.
type session struct {
	handle    string
	path      string
	mb        *backup.MobileBackup
	encrypted bool
	loaded    bool
}

// Engine is the root RPC object. It owns the set of opened backup sessions.
type Engine struct {
	mu       sync.Mutex
	sessions map[string]*session
	seq      int
}

func newEngine() *Engine {
	return &Engine{sessions: make(map[string]*session)}
}

func (e *Engine) handlers() map[string]handlerFunc {
	return map[string]handlerFunc{
		"ping":              e.ping,
		"enumerate_backups": e.enumerateBackups,
		"open_backup":       e.openBackup,
		"close_backup":      e.closeBackup,
		"backup_info":       e.backupInfo,
		"list_domains":      e.listDomains,
		"list_files":        e.listFiles,
		"restore_domain":    e.restoreDomain,
		"export_file":       e.exportFile,
		"export_to_temp":    e.exportToTemp,
		"get_photo_thumb":   e.getPhotoThumb,
		"dump_keychain":     e.dumpKeychain,

		// content extractors
		"list_conversations":   e.listConversations,
		"get_messages":         e.getMessages,
		"list_calls":           e.listCalls,
		"list_contacts":        e.listContacts,
		"list_notes":           e.listNotes,
		"list_browser_history": e.listBrowserHistory,
		"has_browser_history":  e.hasBrowserHistory,
		"list_photos":          e.listPhotos,
		"timeline":             e.timeline,
	}
}

// ── session helpers ─────────────────────────────────────────────────────────

func (e *Engine) newHandle(s *session) string {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.seq++
	h := fmt.Sprintf("b%d", e.seq)
	s.handle = h
	e.sessions[h] = s
	return h
}

func (e *Engine) get(handle string) (*session, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	s, ok := e.sessions[handle]
	if !ok {
		return nil, fmt.Errorf("unknown backup handle %q (open the backup first)", handle)
	}
	return s, nil
}

func (e *Engine) drop(handle string) {
	e.mu.Lock()
	defer e.mu.Unlock()
	delete(e.sessions, handle)
}

// decode is a small helper to unmarshal params into a typed struct.
func decode(raw json.RawMessage, v interface{}) error {
	if len(raw) == 0 {
		return nil
	}
	return json.Unmarshal(raw, v)
}

// ── ping ──────────────────────────────────────────────────────────────────

func (e *Engine) ping(_ json.RawMessage) (interface{}, error) {
	return map[string]interface{}{"pong": true, "version": Version}, nil
}
