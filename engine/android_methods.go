package main

// RPC method bodies for Android sessions. The dispatchers in backup_methods.go /
// preview_methods.go call into these when session.kind == "android", so the
// renderer uses the exact same methods (list_files, export_file, …) regardless
// of whether the source is an iOS backup or an Android extraction.

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"image"
	"image/jpeg"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

func (e *Engine) androidBackupInfo(s *session) (interface{}, error) {
	info := androidSummary(s.ab)
	info["handle"] = s.handle
	info["fileCount"] = len(s.ab.entries)
	info["domainCount"] = len(s.ab.domains())
	info["appCount"] = androidAppCount(s.ab)
	info["apps"] = androidApps(s.ab)
	return info, nil
}

// androidApps lists the package names present as "App: <pkg>" domains.
func androidApps(ab *androidBackup) []string {
	var out []string
	for _, d := range ab.domains() {
		if pkg, ok := strings.CutPrefix(d, "App: "); ok {
			out = append(out, pkg)
		}
	}
	sort.Strings(out)
	return out
}

func androidAppCount(ab *androidBackup) int {
	return len(androidApps(ab))
}

func (e *Engine) androidListDomains(s *session) (interface{}, error) {
	counts := map[string]int{}
	sizes := map[string]int64{}
	for _, en := range s.ab.entries {
		counts[en.Domain]++
		sizes[en.Domain] += en.Size
	}
	var out []map[string]interface{}
	for _, d := range s.ab.domains() {
		out = append(out, map[string]interface{}{
			"domain": d,
			"files":  counts[d],
			"bytes":  sizes[d],
		})
	}
	return map[string]interface{}{"domains": out}, nil
}

func (e *Engine) androidListFiles(s *session, p listFilesParams) (interface{}, error) {
	if p.Limit <= 0 {
		p.Limit = 5000
	}
	var out []map[string]interface{}
	total := 0
	for _, en := range s.ab.entries {
		if en.Size == 0 {
			continue
		}
		if p.Domain != "" && p.Domain != "*" && en.Domain != p.Domain {
			continue
		}
		if p.Query != "" && !containsFold(en.Path, p.Query) && !containsFold(en.Domain, p.Query) {
			continue
		}
		total++
		if len(out) < p.Limit {
			out = append(out, map[string]interface{}{
				"domain": en.Domain,
				"path":   en.Path,
				"bytes":  en.Size,
				"id":     en.ID,
			})
		}
	}
	return map[string]interface{}{"files": out, "total": total, "truncated": total > len(out)}, nil
}

func (e *Engine) androidExportFile(s *session, p exportFileParams) (interface{}, error) {
	if p.Dest == "" {
		return nil, fmt.Errorf("dest is required")
	}
	en := s.ab.find(p.ID, p.Domain, p.Path)
	if en == nil {
		return nil, fmt.Errorf("file not found in extraction")
	}
	data, err := s.ab.read(en)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(filepath.Dir(p.Dest), 0o755); err != nil {
		return nil, err
	}
	if err := os.WriteFile(p.Dest, data, 0o644); err != nil {
		return nil, err
	}
	return map[string]interface{}{"bytes": len(data), "dest": p.Dest}, nil
}

func (e *Engine) androidRestoreDomain(s *session, p restoreParams) (interface{}, error) {
	if p.Dest == "" {
		return nil, fmt.Errorf("dest is required")
	}
	var matches []*androidEntry
	for i := range s.ab.entries {
		en := &s.ab.entries[i]
		if en.Size == 0 {
			continue
		}
		if p.Domain == "*" || p.Domain == "" || en.Domain == p.Domain {
			matches = append(matches, en)
		}
	}

	var written int64
	for i, en := range matches {
		var outPath string
		if p.Domain == "*" || p.Domain == "" {
			outPath = filepath.Join(p.Dest, sanitizeDomain(en.Domain), filepath.FromSlash(en.Path))
		} else {
			outPath = filepath.Join(p.Dest, filepath.FromSlash(en.Path))
		}
		if err := os.MkdirAll(filepath.Dir(outPath), 0o755); err != nil {
			continue
		}
		data, err := s.ab.read(en)
		if err != nil {
			continue
		}
		if err := os.WriteFile(outPath, data, 0o644); err != nil {
			continue
		}
		written += int64(len(data))
		if i%50 == 0 {
			notify("restore.progress", map[string]interface{}{
				"handle": s.handle, "done": i + 1, "total": len(matches),
			})
		}
	}
	notify("restore.progress", map[string]interface{}{
		"handle": s.handle, "done": len(matches), "total": len(matches),
	})
	return map[string]interface{}{"files": len(matches), "bytes": written, "dest": p.Dest}, nil
}

// sanitizeDomain turns a display domain like "App: com.foo" into a filesystem
// folder name for restore_domain output.
func sanitizeDomain(d string) string {
	d = strings.ReplaceAll(d, "App: ", "app-")
	d = strings.ReplaceAll(d, " ", "_")
	d = strings.ReplaceAll(d, "/", "_")
	return d
}

func (e *Engine) androidExportToTemp(s *session, p exportTempParams) (interface{}, error) {
	en := s.ab.find(p.ID, p.Domain, p.Path)
	if en == nil {
		return nil, fmt.Errorf("file not found")
	}
	data, err := s.ab.read(en)
	if err != nil {
		return nil, err
	}
	dir := filepath.Join(os.TempDir(), "osfed-preview")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	name := en.ID
	if name == "" {
		name = "file"
	}
	dst := filepath.Join(dir, name+filepath.Ext(en.Path))
	if err := os.WriteFile(dst, data, 0o644); err != nil {
		return nil, err
	}
	return map[string]interface{}{"path": dst, "bytes": len(data)}, nil
}

func (e *Engine) androidGetPhotoThumb(s *session, p thumbParams) (interface{}, error) {
	en := s.ab.find(p.ID, p.Domain, p.Path)
	if en == nil {
		return nil, fmt.Errorf("file not found")
	}
	ext := strings.ToLower(filepath.Ext(en.Path))
	if !thumbnailable[ext] {
		return map[string]interface{}{"unsupported": true, "reason": "format " + ext}, nil
	}
	data, err := s.ab.read(en)
	if err != nil {
		return nil, err
	}
	img, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return map[string]interface{}{"unsupported": true, "reason": "decode"}, nil
	}
	max := p.Max
	if max <= 0 {
		max = 256
	}
	thumb := scaleMax(img, max)
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, thumb, &jpeg.Options{Quality: 72}); err != nil {
		return nil, err
	}
	return map[string]interface{}{
		"dataUrl": "data:image/jpeg;base64," + base64.StdEncoding.EncodeToString(buf.Bytes()),
		"w":       thumb.Bounds().Dx(),
		"h":       thumb.Bounds().Dy(),
	}, nil
}

// androidDumpKeychain is the Android analogue of dump_keychain. On a non-rooted,
// read-only extraction there is intentionally no access to the Keystore or to
// protected secrets, so this returns the same shape as the iOS keychain dump
// (so the renderer never breaks) but empty, with a note explaining the limit.
// Later milestones populate account names/types, saved Wi-Fi SSIDs and any
// credentials recoverable from app backups.
func (e *Engine) androidDumpKeychain(s *session) (interface{}, error) {
	return map[string]interface{}{
		"platform": "android",
		"counts":   map[string]int{"general": 0, "internet": 0, "certs": 0, "keys": 0},
		"general":  []interface{}{},
		"internet": []interface{}{},
		"certs":    []interface{}{},
		"keys":     []interface{}{},
		"note": "Android stores secrets in the hardware-backed Keystore and in " +
			"per-app sandboxes that a safe, non-rooted extraction cannot read. " +
			"Passwords, tokens and Keystore keys are therefore not available.",
	}, nil
}
