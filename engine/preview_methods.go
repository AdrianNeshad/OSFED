package main

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"image"
	_ "image/gif"  // register GIF decoder
	"image/jpeg"   // decoder + thumbnail encoder
	_ "image/png"  // register PNG decoder
	"os"
	"path/filepath"
	"strings"

	"github.com/dunhamsteve/ios/backup"
)

// Image formats the pure-Go stdlib can decode for inline thumbnails. Everything
// else (HEIC, video, etc.) is still viewable via export_to_temp → OS viewer.
var thumbnailable = map[string]bool{
	".jpg": true, ".jpeg": true, ".png": true, ".gif": true,
}

// recordByRef finds a backup record by its HashCode id, falling back to a
// domain+path match (mirrors export_file's lookup).
func recordByRef(s *session, id, domain, path string) *backup.Record {
	if s.mb == nil {
		return nil
	}
	for i := range s.mb.Records {
		r := &s.mb.Records[i]
		if r.Length == 0 {
			continue
		}
		if id != "" {
			if r.HashCode() == id {
				return r
			}
		} else if r.Domain == domain && r.Path == path {
			return r
		}
	}
	return nil
}

// ── export_to_temp ────────────────────────────────────────────────────────
//
// Decrypts a file to a temp path (keeping its extension) and returns the path,
// so the app can open it in the OS viewer. This is how the GUI shows content it
// cannot render itself (HEIC photos, video, PDF, …) without any extra tooling.

type exportTempParams struct {
	Handle string `json:"handle"`
	ID     string `json:"id"`
	Domain string `json:"domain"`
	Path   string `json:"path"`
}

func (e *Engine) exportToTemp(raw json.RawMessage) (interface{}, error) {
	var p exportTempParams
	if err := decode(raw, &p); err != nil {
		return nil, err
	}
	s, err := e.get(p.Handle)
	if err != nil {
		return nil, err
	}
	if s.kind == "android" {
		return e.androidExportToTemp(s, p)
	}
	rec := recordByRef(s, p.ID, p.Domain, p.Path)
	if rec == nil {
		return nil, fmt.Errorf("file not found")
	}
	data, err := s.mb.ReadFile(*rec)
	if err != nil {
		return nil, fmt.Errorf("could not read file: %w", err)
	}

	dir := filepath.Join(os.TempDir(), "osfed-preview")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	name := rec.HashCode()
	if name == "" {
		name = "file"
	}
	dst := filepath.Join(dir, name+filepath.Ext(rec.Path))
	if err := os.WriteFile(dst, data, 0o644); err != nil {
		return nil, err
	}
	return map[string]interface{}{"path": dst, "bytes": len(data)}, nil
}

// ── get_photo_thumb ───────────────────────────────────────────────────────
//
// Returns a small JPEG data URL for a decodable image, for inline display in
// the Photos grid. Non-decodable formats return {"unsupported": true} so the
// UI keeps its placeholder icon (the file is still openable via export_to_temp).

type thumbParams struct {
	Handle string `json:"handle"`
	ID     string `json:"id"`
	Domain string `json:"domain"`
	Path   string `json:"path"`
	Max    int    `json:"max"`
}

func (e *Engine) getPhotoThumb(raw json.RawMessage) (interface{}, error) {
	var p thumbParams
	if err := decode(raw, &p); err != nil {
		return nil, err
	}
	s, err := e.get(p.Handle)
	if err != nil {
		return nil, err
	}
	if s.kind == "android" {
		return e.androidGetPhotoThumb(s, p)
	}
	rec := recordByRef(s, p.ID, p.Domain, p.Path)
	if rec == nil {
		return nil, fmt.Errorf("file not found")
	}
	ext := strings.ToLower(filepath.Ext(rec.Path))
	if !thumbnailable[ext] {
		return map[string]interface{}{"unsupported": true, "reason": "format " + ext}, nil
	}
	data, err := s.mb.ReadFile(*rec)
	if err != nil {
		return nil, fmt.Errorf("could not read file: %w", err)
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

// scaleMax downsamples src so its longest side is at most max (nearest-neighbor;
// fast and good enough for thumbnails). Returns src unchanged if already small.
func scaleMax(src image.Image, max int) image.Image {
	b := src.Bounds()
	w, h := b.Dx(), b.Dy()
	if w <= max && h <= max {
		return src
	}
	var nw, nh int
	if w >= h {
		nw, nh = max, h*max/w
	} else {
		nh, nw = max, w*max/h
	}
	if nw < 1 {
		nw = 1
	}
	if nh < 1 {
		nh = 1
	}
	dst := image.NewRGBA(image.Rect(0, 0, nw, nh))
	for y := 0; y < nh; y++ {
		sy := b.Min.Y + y*h/nh
		for x := 0; x < nw; x++ {
			sx := b.Min.X + x*w/nw
			dst.Set(x, y, src.At(sx, sy))
		}
	}
	return dst
}
