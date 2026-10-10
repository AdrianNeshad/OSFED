package main

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"time"

	"github.com/dunhamsteve/ios/backup"
	"github.com/dunhamsteve/plist"
)

// ── plist helpers ───────────────────────────────────────────────────────────

func readPlistMap(path string) (map[string]interface{}, error) {
	r, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer r.Close()
	var m map[string]interface{}
	if err := plist.Unmarshal(r, &m); err != nil {
		return nil, err
	}
	return m, nil
}

func pstr(m map[string]interface{}, key string) string {
	if m == nil {
		return ""
	}
	if v, ok := m[key]; ok {
		if s, ok := v.(string); ok {
			return s
		}
		return fmt.Sprintf("%v", v)
	}
	return ""
}

func pbool(m map[string]interface{}, key string) bool {
	if m == nil {
		return false
	}
	if v, ok := m[key]; ok {
		if b, ok := v.(bool); ok {
			return b
		}
	}
	return false
}

func ptime(m map[string]interface{}, key string) string {
	if m == nil {
		return ""
	}
	if v, ok := m[key]; ok {
		if t, ok := v.(time.Time); ok {
			return t.UTC().Format(time.RFC3339)
		}
	}
	return ""
}

// defaultBackupRoot returns the platform MobileSync backup directory.
func defaultBackupRoot() string {
	if runtime.GOOS == "windows" {
		return filepath.Join(os.Getenv("APPDATA"), "Apple Computer", "MobileSync", "Backup")
	}
	if runtime.GOOS == "darwin" {
		return filepath.Join(os.Getenv("HOME"), "Library", "Application Support", "MobileSync", "Backup")
	}
	// Linux / other: no canonical Apple location; callers pass an explicit root.
	return filepath.Join(os.Getenv("HOME"), "MobileSync", "Backup")
}

// summarize reads the unencrypted metadata plists for a single backup folder.
func summarize(dir string) map[string]interface{} {
	manifest, _ := readPlistMap(filepath.Join(dir, "Manifest.plist"))
	info, _ := readPlistMap(filepath.Join(dir, "Info.plist"))

	var lockdown map[string]interface{}
	if manifest != nil {
		if ld, ok := manifest["Lockdown"].(map[string]interface{}); ok {
			lockdown = ld
		}
	}

	deviceName := pstr(info, "Device Name")
	if deviceName == "" {
		deviceName = pstr(lockdown, "DeviceName")
	}
	productVersion := pstr(info, "Product Version")
	if productVersion == "" {
		productVersion = pstr(lockdown, "ProductVersion")
	}
	productType := pstr(info, "Product Type")
	if productType == "" {
		productType = pstr(lockdown, "ProductType")
	}

	lastBackup := ptime(manifest, "Date")
	if lastBackup == "" {
		lastBackup = ptime(info, "Last Backup Date")
	}

	return map[string]interface{}{
		"path":           dir,
		"name":           filepath.Base(dir),
		"platform":       "ios",
		"deviceName":     deviceName,
		"displayName":    pstr(info, "Display Name"),
		"productName":    pstr(info, "Product Name"),
		"productType":    productType,
		"productVersion": productVersion,
		"buildVersion":   pstr(info, "Build Version"),
		"serialNumber":   pstr(info, "Serial Number"),
		"uniqueId":       pstr(info, "Unique Identifier"),
		"imei":           pstr(info, "IMEI"),
		"phoneNumber":    pstr(info, "Phone Number"),
		"lastBackupDate": lastBackup,
		"encrypted":      pbool(manifest, "IsEncrypted"),
		"itunesVersion":  pstr(info, "iTunes Version"),
	}
}

// ── enumerate_backups ─────────────────────────────────────────────────────

type enumerateParams struct {
	Root string `json:"root"`
}

func (e *Engine) enumerateBackups(raw json.RawMessage) (interface{}, error) {
	var p enumerateParams
	if err := decode(raw, &p); err != nil {
		return nil, err
	}
	root := p.Root
	if root == "" {
		root = defaultBackupRoot()
	}

	var out []map[string]interface{}

	// If root itself is a backup folder (contains Manifest.plist), report it.
	if _, err := os.Stat(filepath.Join(root, "Manifest.plist")); err == nil {
		out = append(out, summarize(root))
		return map[string]interface{}{"root": root, "backups": out}, nil
	}

	backups, err := backup.EnumerateDir(root)
	if err != nil {
		// Not an error the UI should treat as fatal — just an empty list with
		// the resolved root so the UI can prompt the user to pick a folder.
		return map[string]interface{}{"root": root, "backups": out, "note": err.Error()}, nil
	}
	for _, b := range backups {
		out = append(out, summarize(b.FileName))
	}
	// Most-recent first.
	sort.Slice(out, func(i, j int) bool {
		return fmt.Sprintf("%v", out[i]["lastBackupDate"]) > fmt.Sprintf("%v", out[j]["lastBackupDate"])
	})
	return map[string]interface{}{"root": root, "backups": out}, nil
}

// ── open_backup ─────────────────────────────────────────────────────────────

type openParams struct {
	Path     string `json:"path"`
	Password string `json:"password"`
}

func (e *Engine) openBackup(raw json.RawMessage) (interface{}, error) {
	var p openParams
	if err := decode(raw, &p); err != nil {
		return nil, err
	}
	if p.Path == "" {
		return nil, fmt.Errorf("path is required")
	}

	// Android source: an `.ab` file, or a directory that is not an iOS backup.
	if isAndroidSource(p.Path) {
		ab, err := openAndroidBackup(p.Path, p.Password)
		if err != nil {
			return nil, err
		}
		s := &session{path: p.Path, kind: "android", ab: ab, encrypted: ab.encrypted, loaded: true}
		handle := e.newHandle(s)
		info := androidSummary(ab)
		info["handle"] = handle
		info["fileCount"] = len(ab.entries)
		info["domainCount"] = len(ab.domains())
		info["appCount"] = androidAppCount(ab)
		return info, nil
	}

	mb, err := backup.OpenDir(p.Path)
	if err != nil {
		return nil, fmt.Errorf("could not open backup: %w", err)
	}

	s := &session{path: p.Path, kind: "ios", mb: mb, encrypted: mb.Manifest.IsEncrypted}

	if mb.Manifest.IsEncrypted {
		if p.Password == "" {
			return nil, fmt.Errorf("PASSWORD_REQUIRED: this backup is encrypted; a password is required")
		}
		if err := mb.SetPassword(p.Password); err != nil {
			return nil, fmt.Errorf("WRONG_PASSWORD: could not decrypt keybag: %v", err)
		}
	}

	if err := mb.Load(); err != nil {
		return nil, fmt.Errorf("could not load manifest: %w", err)
	}
	s.loaded = true

	handle := e.newHandle(s)
	info := summarize(p.Path)
	info["handle"] = handle
	info["fileCount"] = len(mb.Records)
	info["domainCount"] = len(mb.Domains())
	info["appCount"] = len(mb.Manifest.Applications)
	return info, nil
}

func (e *Engine) closeBackup(raw json.RawMessage) (interface{}, error) {
	var p struct {
		Handle string `json:"handle"`
	}
	if err := decode(raw, &p); err != nil {
		return nil, err
	}
	if s, err := e.get(p.Handle); err == nil && s.ab != nil {
		s.ab.close() // remove the temp tar for an `.ab` source
	}
	e.drop(p.Handle)
	return map[string]interface{}{"closed": true}, nil
}

// ── backup_info ─────────────────────────────────────────────────────────────

func (e *Engine) backupInfo(raw json.RawMessage) (interface{}, error) {
	var p struct {
		Handle string `json:"handle"`
	}
	if err := decode(raw, &p); err != nil {
		return nil, err
	}
	s, err := e.get(p.Handle)
	if err != nil {
		return nil, err
	}
	if s.kind == "android" {
		return e.androidBackupInfo(s)
	}
	info := summarize(s.path)
	info["handle"] = s.handle
	info["fileCount"] = len(s.mb.Records)
	info["domainCount"] = len(s.mb.Domains())
	info["appCount"] = len(s.mb.Manifest.Applications)

	apps := make([]string, 0, len(s.mb.Manifest.Applications))
	for a := range s.mb.Manifest.Applications {
		apps = append(apps, a)
	}
	sort.Strings(apps)
	info["apps"] = apps
	return info, nil
}

// ── list_domains ──────────────────────────────────────────────────────────

func (e *Engine) listDomains(raw json.RawMessage) (interface{}, error) {
	var p struct {
		Handle string `json:"handle"`
	}
	if err := decode(raw, &p); err != nil {
		return nil, err
	}
	s, err := e.get(p.Handle)
	if err != nil {
		return nil, err
	}
	if s.kind == "android" {
		return e.androidListDomains(s)
	}

	counts := map[string]int{}
	sizes := map[string]int64{}
	for _, rec := range s.mb.Records {
		counts[rec.Domain]++
		sizes[rec.Domain] += int64(rec.Length)
	}
	var out []map[string]interface{}
	for _, d := range s.mb.Domains() {
		out = append(out, map[string]interface{}{
			"domain": d,
			"files":  counts[d],
			"bytes":  sizes[d],
		})
	}
	return map[string]interface{}{"domains": out}, nil
}

// ── list_files ────────────────────────────────────────────────────────────

type listFilesParams struct {
	Handle string `json:"handle"`
	Domain string `json:"domain"` // "*" or "" means all domains
	Query  string `json:"query"`
	Limit  int    `json:"limit"`
}

func (e *Engine) listFiles(raw json.RawMessage) (interface{}, error) {
	var p listFilesParams
	if err := decode(raw, &p); err != nil {
		return nil, err
	}
	s, err := e.get(p.Handle)
	if err != nil {
		return nil, err
	}
	if s.kind == "android" {
		return e.androidListFiles(s, p)
	}
	if p.Limit <= 0 {
		p.Limit = 5000
	}

	var out []map[string]interface{}
	total := 0
	for _, rec := range s.mb.Records {
		if rec.Length == 0 {
			continue
		}
		if p.Domain != "" && p.Domain != "*" && rec.Domain != p.Domain {
			continue
		}
		if p.Query != "" && !containsFold(rec.Path, p.Query) && !containsFold(rec.Domain, p.Query) {
			continue
		}
		total++
		if len(out) < p.Limit {
			out = append(out, map[string]interface{}{
				"domain": rec.Domain,
				"path":   rec.Path,
				"bytes":  int64(rec.Length),
				"id":     rec.HashCode(),
			})
		}
	}
	return map[string]interface{}{"files": out, "total": total, "truncated": total > len(out)}, nil
}

// ── export_file (single decrypted file) ─────────────────────────────────────

type exportFileParams struct {
	Handle string `json:"handle"`
	ID     string `json:"id"`     // record HashCode (preferred)
	Domain string `json:"domain"` // fallback match
	Path   string `json:"path"`   // fallback match
	Dest   string `json:"dest"`   // full destination file path
}

func (e *Engine) exportFile(raw json.RawMessage) (interface{}, error) {
	var p exportFileParams
	if err := decode(raw, &p); err != nil {
		return nil, err
	}
	s, err := e.get(p.Handle)
	if err != nil {
		return nil, err
	}
	if s.kind == "android" {
		return e.androidExportFile(s, p)
	}
	if p.Dest == "" {
		return nil, fmt.Errorf("dest is required")
	}

	var rec *backup.Record
	for i := range s.mb.Records {
		r := &s.mb.Records[i]
		if r.Length == 0 {
			continue
		}
		if p.ID != "" {
			if r.HashCode() == p.ID {
				rec = r
				break
			}
		} else if r.Domain == p.Domain && r.Path == p.Path {
			rec = r
			break
		}
	}
	if rec == nil {
		return nil, fmt.Errorf("file not found in backup")
	}

	if err := os.MkdirAll(filepath.Dir(p.Dest), 0o755); err != nil {
		return nil, err
	}
	// ReadFile decrypts the whole file (same path dump_keychain uses); it is
	// robust for the small-file case where the streaming FileReader mishandles
	// the final short block.
	data, err := s.mb.ReadFile(*rec)
	if err != nil {
		return nil, fmt.Errorf("could not read file: %w", err)
	}
	if err := os.WriteFile(p.Dest, data, 0o644); err != nil {
		return nil, err
	}
	return map[string]interface{}{"bytes": len(data), "dest": p.Dest}, nil
}

// ── restore_domain ──────────────────────────────────────────────────────────

type restoreParams struct {
	Handle string `json:"handle"`
	Domain string `json:"domain"` // "*" for everything
	Dest   string `json:"dest"`
}

func (e *Engine) restoreDomain(raw json.RawMessage) (interface{}, error) {
	var p restoreParams
	if err := decode(raw, &p); err != nil {
		return nil, err
	}
	s, err := e.get(p.Handle)
	if err != nil {
		return nil, err
	}
	if s.kind == "android" {
		return e.androidRestoreDomain(s, p)
	}
	if p.Dest == "" {
		return nil, fmt.Errorf("dest is required")
	}

	// Count matching files first for progress reporting.
	var matches []backup.Record
	for _, rec := range s.mb.Records {
		if rec.Length == 0 {
			continue
		}
		if p.Domain == "*" || p.Domain == "" || rec.Domain == p.Domain {
			matches = append(matches, rec)
		}
	}

	var written int64
	for i, rec := range matches {
		var outPath string
		if p.Domain == "*" || p.Domain == "" {
			outPath = filepath.Join(p.Dest, rec.Domain, rec.Path)
		} else {
			outPath = filepath.Join(p.Dest, rec.Path)
		}
		if err := os.MkdirAll(filepath.Dir(outPath), 0o755); err != nil {
			continue
		}
		r, err := s.mb.FileReader(rec)
		if err != nil {
			continue
		}
		w, err := os.Create(outPath)
		if err != nil {
			r.Close()
			continue
		}
		n, _ := io.Copy(w, r)
		written += n
		r.Close()
		w.Close()

		if i%50 == 0 {
			notify("restore.progress", map[string]interface{}{
				"handle": p.Handle,
				"done":   i + 1,
				"total":  len(matches),
			})
		}
	}
	notify("restore.progress", map[string]interface{}{
		"handle": p.Handle, "done": len(matches), "total": len(matches),
	})
	return map[string]interface{}{"files": len(matches), "bytes": written, "dest": p.Dest}, nil
}
