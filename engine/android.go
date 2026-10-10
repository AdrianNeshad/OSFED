package main

// Android extraction reader.
//
// OSFED reads Android acquisitions with the SAME session/handle model it uses
// for iOS backups, so the renderer's Files browser, previews and exports work
// unchanged. Two source shapes are supported, both NON-DESTRUCTIVE and
// root-free:
//
//   1. An ADB backup file (`.ab`) produced by `adb backup`. The format is a
//      short text header followed by an (optionally AES-256-CBC encrypted,
//      optionally zlib-compressed) tar stream. We decrypt/inflate it to a temp
//      tar once at open time and then random-access its entries.
//
//   2. A directory — an "OSFED Android extraction" folder (what the live ADB
//      puller writes) or any folder the user points at (e.g. a pulled
//      /sdcard tree). We simply index the file tree.
//
// There is deliberately no rooting, no bootloader unlock and no /data access
// here: everything is read-only against artifacts the user already has.

import (
	"archive/tar"
	"bufio"
	"bytes"
	"compress/zlib"
	"crypto/aes"
	"crypto/cipher"
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"golang.org/x/crypto/pbkdf2"
)

// androidEntry is one file inside an Android extraction, normalized to the same
// (domain, path, size, id) shape the iOS Record exposes.
type androidEntry struct {
	Domain string
	Path   string
	Size   int64
	ID     string

	// Source location: exactly one of these is used depending on ab.kind.
	tarOffset int64  // "ab": byte offset of the file data inside tarPath
	diskPath  string // "dir": absolute path on disk
}

// androidBackup is one opened Android source (an `.ab` file or a folder).
type androidBackup struct {
	kind      string // "ab" | "dir"
	srcPath   string
	tarPath   string // temp decrypted+inflated tar (kind=="ab" only)
	encrypted bool
	entries   []androidEntry
	meta      map[string]interface{}
}

// hashID mirrors backup.Record.HashCode so Android ids are stable and computed
// the same way (sha1 of "domain-path").
func hashID(domain, path string) string {
	sum := sha1.Sum([]byte(domain + "-" + path))
	return hex.EncodeToString(sum[:])
}

// isAndroidSource reports whether open_backup should treat path as an Android
// extraction: an `.ab` file, or a directory that is not an iOS backup (iOS
// backups always contain a Manifest.plist).
func isAndroidSource(path string) bool {
	fi, err := os.Stat(path)
	if err != nil {
		return false
	}
	if !fi.IsDir() {
		return isAndroidBackupFile(path)
	}
	if _, err := os.Stat(filepath.Join(path, "Manifest.plist")); err == nil {
		return false // it's an iOS backup folder
	}
	return true
}

// openAndroidBackup opens either an `.ab` file or a directory.
func openAndroidBackup(srcPath, password string) (*androidBackup, error) {
	fi, err := os.Stat(srcPath)
	if err != nil {
		return nil, err
	}
	if fi.IsDir() {
		return openAndroidDir(srcPath)
	}
	return openAndroidAB(srcPath, password)
}

// isAndroidBackupFile reports whether path is an `adb backup` archive, by
// extension or by the "ANDROID BACKUP" magic line.
func isAndroidBackupFile(path string) bool {
	if strings.EqualFold(filepath.Ext(path), ".ab") {
		return true
	}
	f, err := os.Open(path)
	if err != nil {
		return false
	}
	defer f.Close()
	head := make([]byte, 14)
	if _, err := io.ReadFull(f, head); err != nil {
		return false
	}
	return string(head) == "ANDROID BACKUP"
}

// ── directory source ────────────────────────────────────────────────────────

func openAndroidDir(root string) (*androidBackup, error) {
	ab := &androidBackup{kind: "dir", srcPath: root, meta: map[string]interface{}{}}

	// An OSFED extraction folder may carry a metadata.json describing the device.
	if b, err := os.ReadFile(filepath.Join(root, "osfed-android.json")); err == nil {
		var m map[string]interface{}
		if json.Unmarshal(b, &m) == nil {
			ab.meta = m
		}
	}

	err := filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil // skip unreadable entries rather than aborting the walk
		}
		if d.IsDir() {
			return nil
		}
		info, err := d.Info()
		if err != nil {
			return nil
		}
		rel, err := filepath.Rel(root, p)
		if err != nil {
			return nil
		}
		rel = filepath.ToSlash(rel)
		if rel == "osfed-android.json" {
			return nil
		}
		dom, pth := splitDirDomain(rel)
		ab.entries = append(ab.entries, androidEntry{
			Domain: dom, Path: pth, Size: info.Size(), ID: hashID(dom, pth), diskPath: p,
		})
		return nil
	})
	if err != nil {
		return nil, err
	}
	sortEntries(ab.entries)
	return ab, nil
}

// splitDirDomain groups a relative path by its first component so the Files
// browser shows meaningful domains (e.g. "DCIM", "Download", "apps").
func splitDirDomain(rel string) (domain, path string) {
	i := strings.IndexByte(rel, '/')
	if i < 0 {
		return "(root)", rel
	}
	return rel[:i], rel[i+1:]
}

// ── .ab (adb backup) source ─────────────────────────────────────────────────

func openAndroidAB(srcPath, password string) (*androidBackup, error) {
	f, err := os.Open(srcPath)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	// The header is newline-delimited ASCII. Reading it with a bufio.Reader is
	// fine because, once the header lines are consumed, we read the REST of the
	// payload from that same bufio.Reader (so no bytes are lost to buffering).
	br := bufio.NewReader(f)

	magic, err := br.ReadString('\n')
	if err != nil || strings.TrimRight(magic, "\r\n") != "ANDROID BACKUP" {
		return nil, fmt.Errorf("not an Android backup file (bad magic)")
	}
	if _, err := br.ReadString('\n'); err != nil { // version — not needed for reading
		return nil, fmt.Errorf("truncated Android backup header")
	}
	compLine, err := br.ReadString('\n')
	if err != nil {
		return nil, fmt.Errorf("truncated Android backup header")
	}
	encLine, err := br.ReadString('\n')
	if err != nil {
		return nil, fmt.Errorf("truncated Android backup header")
	}
	compressed := strings.TrimRight(compLine, "\r\n") == "1"
	enc := strings.TrimRight(encLine, "\r\n")

	ab := &androidBackup{kind: "ab", srcPath: srcPath, meta: map[string]interface{}{}}

	// payload is the (still compressed) tar stream once any encryption is peeled.
	var payload io.Reader = br

	switch {
	case strings.EqualFold(enc, "none") || enc == "":
		// nothing to do
	case strings.EqualFold(enc, "AES-256"):
		ab.encrypted = true
		masterKey, masterIV, err := abDecryptMasterKey(br, password)
		if err != nil {
			return nil, err
		}
		ct, err := io.ReadAll(br)
		if err != nil {
			return nil, fmt.Errorf("could not read encrypted payload: %w", err)
		}
		if len(ct) == 0 || len(ct)%aes.BlockSize != 0 {
			return nil, fmt.Errorf("WRONG_PASSWORD: encrypted payload is not block-aligned")
		}
		block, err := aes.NewCipher(masterKey)
		if err != nil {
			return nil, err
		}
		pt := make([]byte, len(ct))
		cipher.NewCBCDecrypter(block, masterIV).CryptBlocks(pt, ct)
		pt, ok := pkcs7Unpad(pt)
		if !ok {
			return nil, fmt.Errorf("WRONG_PASSWORD: could not decrypt backup (bad padding)")
		}
		payload = bytes.NewReader(pt)
	default:
		return nil, fmt.Errorf("unsupported Android backup encryption %q", enc)
	}

	// Materialize the tar to a temp file so entries can be read randomly.
	tmp, err := os.CreateTemp("", "osfed-android-*.tar")
	if err != nil {
		return nil, err
	}
	tmpName := tmp.Name()

	var src io.Reader = payload
	if compressed {
		zr, err := zlib.NewReader(payload)
		if err != nil {
			tmp.Close()
			os.Remove(tmpName)
			if ab.encrypted {
				return nil, fmt.Errorf("WRONG_PASSWORD: could not decompress backup (%v)", err)
			}
			return nil, fmt.Errorf("could not decompress backup: %w", err)
		}
		defer zr.Close()
		src = zr
	}
	if _, err := io.Copy(tmp, src); err != nil {
		tmp.Close()
		os.Remove(tmpName)
		return nil, fmt.Errorf("could not unpack backup: %w", err)
	}
	tmp.Close()
	ab.tarPath = tmpName

	if err := indexTar(ab); err != nil {
		os.Remove(tmpName)
		return nil, err
	}
	sortEntries(ab.entries)
	return ab, nil
}

// abDecryptMasterKey reads the 5 encryption header lines and recovers the master
// key + IV used for the payload, per the documented Android Backup format:
//
//	user-password-salt (hex)
//	master-key-checksum-salt (hex)   [unused for reading]
//	PBKDF2 round count
//	user-key IV (hex)
//	master-key blob (hex)
//
// userKey = PBKDF2-HMAC-SHA1(password, userSalt, rounds, 32); the blob is
// AES-256-CBC(userKey, userIV)-encrypted and, once unpadded, holds
// [len|masterIV][len|masterKey][len|checksum]. The checksum is not verified
// (the payload itself fails to unpad/inflate on a wrong password, which is the
// signal we surface).
func abDecryptMasterKey(br *bufio.Reader, password string) (masterKey, masterIV []byte, err error) {
	if password == "" {
		return nil, nil, fmt.Errorf("PASSWORD_REQUIRED: this Android backup is encrypted; a password is required")
	}
	readHex := func() ([]byte, error) {
		line, err := br.ReadString('\n')
		if err != nil {
			return nil, fmt.Errorf("truncated encrypted Android backup header")
		}
		return hex.DecodeString(strings.TrimRight(line, "\r\n"))
	}
	userSalt, err := readHex()
	if err != nil {
		return nil, nil, err
	}
	if _, err := br.ReadString('\n'); err != nil { // checksum salt — unused
		return nil, nil, fmt.Errorf("truncated encrypted Android backup header")
	}
	roundsLine, err := br.ReadString('\n')
	if err != nil {
		return nil, nil, fmt.Errorf("truncated encrypted Android backup header")
	}
	rounds, err := strconv.Atoi(strings.TrimRight(roundsLine, "\r\n"))
	if err != nil || rounds <= 0 {
		return nil, nil, fmt.Errorf("invalid PBKDF2 round count in Android backup header")
	}
	userIV, err := readHex()
	if err != nil {
		return nil, nil, err
	}
	blob, err := readHex()
	if err != nil {
		return nil, nil, err
	}

	userKey := pbkdf2.Key([]byte(password), userSalt, rounds, 32, sha1.New)
	block, err := aes.NewCipher(userKey)
	if err != nil {
		return nil, nil, err
	}
	if len(blob) == 0 || len(blob)%aes.BlockSize != 0 {
		return nil, nil, fmt.Errorf("WRONG_PASSWORD: master-key blob is not block-aligned")
	}
	dec := make([]byte, len(blob))
	cipher.NewCBCDecrypter(block, userIV).CryptBlocks(dec, blob)
	dec, ok := pkcs7Unpad(dec)
	if !ok {
		return nil, nil, fmt.Errorf("WRONG_PASSWORD: could not unwrap master key")
	}

	r := bytes.NewReader(dec)
	masterIV, err = readLenPrefixed(r)
	if err != nil {
		return nil, nil, fmt.Errorf("WRONG_PASSWORD: malformed master-key blob")
	}
	masterKey, err = readLenPrefixed(r)
	if err != nil {
		return nil, nil, fmt.Errorf("WRONG_PASSWORD: malformed master-key blob")
	}
	return masterKey, masterIV, nil
}

// readLenPrefixed reads a single length byte followed by that many bytes.
func readLenPrefixed(r *bytes.Reader) ([]byte, error) {
	n, err := r.ReadByte()
	if err != nil {
		return nil, err
	}
	buf := make([]byte, int(n))
	if _, err := io.ReadFull(r, buf); err != nil {
		return nil, err
	}
	return buf, nil
}

// pkcs7Unpad removes PKCS#5/#7 padding, reporting false if the padding is
// invalid (the usual symptom of a wrong password).
func pkcs7Unpad(b []byte) ([]byte, bool) {
	if len(b) == 0 || len(b)%aes.BlockSize != 0 {
		return nil, false
	}
	n := int(b[len(b)-1])
	if n == 0 || n > aes.BlockSize || n > len(b) {
		return nil, false
	}
	for _, c := range b[len(b)-n:] {
		if int(c) != n {
			return nil, false
		}
	}
	return b[:len(b)-n], true
}

// countReader tracks how many bytes have been consumed from the underlying
// reader, so indexTar can record each tar entry's data offset. It must wrap the
// file directly (no buffering in between) for the count to equal the file
// position where the entry's data begins.
type countReader struct {
	r io.Reader
	n int64
}

func (c *countReader) Read(p []byte) (int, error) {
	m, err := c.r.Read(p)
	c.n += int64(m)
	return m, err
}

// indexTar walks the decrypted/inflated tar and records every regular file's
// domain, path, size and data offset for later random-access reads.
func indexTar(ab *androidBackup) error {
	f, err := os.Open(ab.tarPath)
	if err != nil {
		return err
	}
	defer f.Close()

	cr := &countReader{r: f}
	tr := tar.NewReader(cr)
	for {
		h, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return fmt.Errorf("could not read Android backup tar: %w", err)
		}
		if h.Typeflag != tar.TypeReg {
			continue
		}
		// After Next() returns, the underlying reader sits exactly at this
		// entry's data (tar aligns headers to 512-byte blocks).
		off := cr.n
		dom, pth := splitAbName(h.Name)
		ab.entries = append(ab.entries, androidEntry{
			Domain: dom, Path: pth, Size: h.Size, ID: hashID(dom, pth), tarOffset: off,
		})
	}
	return nil
}

// splitAbName maps an adb-backup tar path to a (domain, path) pair:
//
//	apps/<pkg>/<type>/<rest>  → "App: <pkg>", "<type>/<rest>"
//	shared/<user>/<rest>      → "Shared storage", "<rest>"
//	<anything else>           → "Other", "<name>"
func splitAbName(name string) (domain, path string) {
	name = strings.TrimPrefix(name, "./")
	parts := strings.SplitN(name, "/", 3)
	switch parts[0] {
	case "apps":
		if len(parts) >= 2 {
			rest := ""
			if len(parts) == 3 {
				rest = parts[2]
			}
			return "App: " + parts[1], rest
		}
	case "shared":
		rest := ""
		if len(parts) == 3 {
			rest = parts[2]
		} else if len(parts) == 2 {
			rest = parts[1]
		}
		return "Shared storage", rest
	}
	return "Other", name
}

// ── shared helpers ────────────────────────────────────────────────────────

func sortEntries(entries []androidEntry) {
	sort.Slice(entries, func(i, j int) bool {
		if entries[i].Domain != entries[j].Domain {
			return entries[i].Domain < entries[j].Domain
		}
		return entries[i].Path < entries[j].Path
	})
}

func (ab *androidBackup) find(id, domain, path string) *androidEntry {
	for i := range ab.entries {
		e := &ab.entries[i]
		if id != "" {
			if e.ID == id {
				return e
			}
			continue
		}
		if e.Domain == domain && e.Path == path {
			return e
		}
	}
	return nil
}

func (ab *androidBackup) read(e *androidEntry) ([]byte, error) {
	if ab.kind == "dir" {
		return os.ReadFile(e.diskPath)
	}
	f, err := os.Open(ab.tarPath)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	if _, err := f.Seek(e.tarOffset, io.SeekStart); err != nil {
		return nil, err
	}
	buf := make([]byte, e.Size)
	if _, err := io.ReadFull(f, buf); err != nil {
		return nil, fmt.Errorf("could not read entry: %w", err)
	}
	return buf, nil
}

func (ab *androidBackup) domains() []string {
	seen := map[string]bool{}
	var out []string
	for _, e := range ab.entries {
		if !seen[e.Domain] {
			seen[e.Domain] = true
			out = append(out, e.Domain)
		}
	}
	sort.Strings(out)
	return out
}

func (ab *androidBackup) close() {
	if ab.kind == "ab" && ab.tarPath != "" {
		os.Remove(ab.tarPath)
		ab.tarPath = ""
	}
}

func (ab *androidBackup) metaStr(key string) string {
	if ab.meta == nil {
		return ""
	}
	if v, ok := ab.meta[key].(string); ok {
		return v
	}
	return ""
}

// androidSummary mirrors summarize() for Android sources, filling the same
// BackupSummary fields the renderer expects (unknown-to-Android fields stay
// empty) plus a "platform" marker so the UI can adapt.
func androidSummary(ab *androidBackup) map[string]interface{} {
	name := ab.metaStr("deviceName")
	if name == "" {
		name = filepath.Base(ab.srcPath)
	}
	return map[string]interface{}{
		"path":           ab.srcPath,
		"name":           filepath.Base(ab.srcPath),
		"platform":       "android",
		"sourceKind":     ab.kind, // "ab" | "dir"
		"deviceName":     name,
		"displayName":    ab.metaStr("displayName"),
		"productName":    firstNonEmpty(ab.metaStr("productName"), "Android device"),
		"productType":    ab.metaStr("model"),
		"productVersion": ab.metaStr("androidVersion"),
		"buildVersion":   ab.metaStr("buildVersion"),
		"serialNumber":   ab.metaStr("serial"),
		"uniqueId":       ab.metaStr("androidId"),
		"imei":           ab.metaStr("imei"),
		"phoneNumber":    ab.metaStr("phoneNumber"),
		"lastBackupDate": ab.metaStr("date"),
		"encrypted":      ab.encrypted,
		"itunesVersion":  "",
	}
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if v != "" {
			return v
		}
	}
	return ""
}
