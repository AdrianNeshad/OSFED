package main

import (
	"archive/tar"
	"bytes"
	"compress/zlib"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha1"
	"encoding/hex"
	"image"
	"image/color"
	"image/jpeg"
	"os"
	"path/filepath"
	"testing"

	"golang.org/x/crypto/pbkdf2"
)

// tinyJPEG returns the bytes of a small valid JPEG, used to exercise the
// thumbnail path on an Android source.
func tinyJPEG(t *testing.T) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, 8, 8))
	for y := 0; y < 8; y++ {
		for x := 0; x < 8; x++ {
			img.Set(x, y, color.RGBA{uint8(x * 32), uint8(y * 32), 128, 255})
		}
	}
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, nil); err != nil {
		t.Fatalf("encode jpeg: %v", err)
	}
	return buf.Bytes()
}

// sampleEntries is the set of files packed into the test backups.
func sampleEntries(t *testing.T) map[string][]byte {
	return map[string][]byte{
		"apps/com.example.app/_manifest":    []byte("manifest"),
		"apps/com.example.app/db/notes.db":  []byte("SQLite format 3\x00rest-of-db"),
		"apps/com.example.app/sp/prefs.xml": []byte("<map><string name=\"token\">abc</string></map>"),
		"shared/0/DCIM/Camera/IMG_0001.jpg": tinyJPEG(t),
		"shared/0/Download/report.txt":      []byte("hello android"),
	}
}

// makeTar packs entries into an uncompressed tar byte slice.
func makeTar(t *testing.T, entries map[string][]byte) []byte {
	t.Helper()
	var buf bytes.Buffer
	tw := tar.NewWriter(&buf)
	// Deterministic order not required; tar is read by header.
	for name, data := range entries {
		if err := tw.WriteHeader(&tar.Header{Name: name, Mode: 0o644, Size: int64(len(data)), Typeflag: tar.TypeReg}); err != nil {
			t.Fatalf("tar header: %v", err)
		}
		if _, err := tw.Write(data); err != nil {
			t.Fatalf("tar write: %v", err)
		}
	}
	if err := tw.Close(); err != nil {
		t.Fatalf("tar close: %v", err)
	}
	return buf.Bytes()
}

func zlibCompress(t *testing.T, b []byte) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := zlib.NewWriter(&buf)
	zw.Write(b)
	zw.Close()
	return buf.Bytes()
}

func pkcs7Pad(b []byte) []byte {
	n := aes.BlockSize - len(b)%aes.BlockSize
	pad := bytes.Repeat([]byte{byte(n)}, n)
	return append(b, pad...)
}

// writeUnencryptedAB builds a compressed, unencrypted `.ab` on disk.
func writeUnencryptedAB(t *testing.T, path string, entries map[string][]byte) {
	t.Helper()
	payload := zlibCompress(t, makeTar(t, entries))
	var buf bytes.Buffer
	buf.WriteString("ANDROID BACKUP\n1\n1\nnone\n")
	buf.Write(payload)
	if err := os.WriteFile(path, buf.Bytes(), 0o644); err != nil {
		t.Fatalf("write ab: %v", err)
	}
}

// writeEncryptedAB builds a compressed, AES-256 encrypted `.ab` on disk,
// following the documented Android Backup key-derivation so the reader is
// tested against the real format.
func writeEncryptedAB(t *testing.T, path, password string, entries map[string][]byte) {
	t.Helper()
	rounds := 10000
	userSalt := make([]byte, 64)
	ckSalt := make([]byte, 64)
	userIV := make([]byte, 16)
	masterIV := make([]byte, 16)
	masterKey := make([]byte, 32)
	for _, b := range [][]byte{userSalt, ckSalt, userIV, masterIV, masterKey} {
		rand.Read(b)
	}

	// Master-key blob: [len|masterIV][len|masterKey][len|checksum], CBC-encrypted
	// with the user key. Checksum is ignored by the reader, so zeros suffice.
	checksum := make([]byte, 32)
	var blob bytes.Buffer
	blob.WriteByte(byte(len(masterIV)))
	blob.Write(masterIV)
	blob.WriteByte(byte(len(masterKey)))
	blob.Write(masterKey)
	blob.WriteByte(byte(len(checksum)))
	blob.Write(checksum)

	userKey := pbkdf2.Key([]byte(password), userSalt, rounds, 32, sha1.New)
	ub, _ := aes.NewCipher(userKey)
	blobPadded := pkcs7Pad(blob.Bytes())
	blobCT := make([]byte, len(blobPadded))
	cipher.NewCBCEncrypter(ub, userIV).CryptBlocks(blobCT, blobPadded)

	// Payload: tar → zlib → pad → AES-CBC(masterKey, masterIV).
	payloadPlain := pkcs7Pad(zlibCompress(t, makeTar(t, entries)))
	mb, _ := aes.NewCipher(masterKey)
	payloadCT := make([]byte, len(payloadPlain))
	cipher.NewCBCEncrypter(mb, masterIV).CryptBlocks(payloadCT, payloadPlain)

	var buf bytes.Buffer
	buf.WriteString("ANDROID BACKUP\n5\n1\nAES-256\n")
	buf.WriteString(hex.EncodeToString(userSalt) + "\n")
	buf.WriteString(hex.EncodeToString(ckSalt) + "\n")
	buf.WriteString("10000\n")
	buf.WriteString(hex.EncodeToString(userIV) + "\n")
	buf.WriteString(hex.EncodeToString(blobCT) + "\n")
	buf.Write(payloadCT)
	if err := os.WriteFile(path, buf.Bytes(), 0o644); err != nil {
		t.Fatalf("write ab: %v", err)
	}
}

// assertBackupReads runs the shared assertions against an opened Android source.
func assertBackupReads(t *testing.T, ab *androidBackup, entries map[string][]byte) {
	t.Helper()
	if len(ab.entries) != len(entries) {
		t.Fatalf("entry count = %d, want %d", len(ab.entries), len(entries))
	}

	// Domain mapping: apps/<pkg> → "App: <pkg>", shared/0 → "Shared storage".
	wantDomains := map[string]bool{"App: com.example.app": true, "Shared storage": true}
	for _, d := range ab.domains() {
		delete(wantDomains, d)
	}
	if len(wantDomains) != 0 {
		t.Fatalf("missing domains: %v (got %v)", wantDomains, ab.domains())
	}

	// Read a known file back and compare bytes.
	en := ab.find("", "Shared storage", "Download/report.txt")
	if en == nil {
		t.Fatalf("report.txt not found; entries=%+v", ab.entries)
	}
	got, err := ab.read(en)
	if err != nil {
		t.Fatalf("read report.txt: %v", err)
	}
	if !bytes.Equal(got, entries["shared/0/Download/report.txt"]) {
		t.Fatalf("report.txt bytes mismatch: %q", got)
	}

	// Read by stable id (sha1 of domain-path) too.
	if ab.find(en.ID, "", "") == nil {
		t.Fatalf("find by id failed for %s", en.ID)
	}
}

func TestOpenUnencryptedAB(t *testing.T) {
	entries := sampleEntries(t)
	path := filepath.Join(t.TempDir(), "backup.ab")
	writeUnencryptedAB(t, path, entries)

	if !isAndroidSource(path) {
		t.Fatal("isAndroidSource = false for .ab file")
	}
	ab, err := openAndroidBackup(path, "")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer ab.close()
	if ab.encrypted {
		t.Fatal("unencrypted backup reported as encrypted")
	}
	assertBackupReads(t, ab, entries)
}

func TestOpenEncryptedAB(t *testing.T) {
	entries := sampleEntries(t)
	path := filepath.Join(t.TempDir(), "enc.ab")
	writeEncryptedAB(t, path, "demo-pass-123", entries)

	// Wrong / missing password must fail cleanly, not panic.
	if _, err := openAndroidBackup(path, ""); err == nil {
		t.Fatal("expected error with empty password")
	}
	if _, err := openAndroidBackup(path, "wrong-password"); err == nil {
		t.Fatal("expected error with wrong password")
	}

	ab, err := openAndroidBackup(path, "demo-pass-123")
	if err != nil {
		t.Fatalf("open with correct password: %v", err)
	}
	defer ab.close()
	if !ab.encrypted {
		t.Fatal("encrypted backup not reported as encrypted")
	}
	assertBackupReads(t, ab, entries)
}

func TestOpenDirSource(t *testing.T) {
	entries := sampleEntries(t)
	root := t.TempDir()
	for name, data := range entries {
		p := filepath.Join(root, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, data, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	if !isAndroidSource(root) {
		t.Fatal("isAndroidSource = false for non-iOS directory")
	}
	ab, err := openAndroidBackup(root, "")
	if err != nil {
		t.Fatalf("open dir: %v", err)
	}
	if len(ab.entries) != len(entries) {
		t.Fatalf("dir entry count = %d, want %d", len(ab.entries), len(entries))
	}
	// Directory domains are the first path component.
	en := ab.find("", "apps", "com.example.app/db/notes.db")
	if en == nil {
		t.Fatalf("notes.db not found in dir; entries=%+v", ab.entries)
	}
	got, _ := ab.read(en)
	if !bytes.Equal(got, entries["apps/com.example.app/db/notes.db"]) {
		t.Fatal("dir read mismatch")
	}
}

func TestAndroidThumbAndKeychain(t *testing.T) {
	entries := sampleEntries(t)
	path := filepath.Join(t.TempDir(), "backup.ab")
	writeUnencryptedAB(t, path, entries)
	ab, err := openAndroidBackup(path, "")
	if err != nil {
		t.Fatal(err)
	}
	defer ab.close()

	e := newEngine()
	s := &session{handle: "a1", kind: "android", ab: ab}
	e.sessions["a1"] = s

	// Thumbnail of the embedded JPEG should succeed (dataUrl present).
	res, err := e.androidGetPhotoThumb(s, thumbParams{Handle: "a1", Domain: "Shared storage", Path: "DCIM/Camera/IMG_0001.jpg"})
	if err != nil {
		t.Fatalf("thumb: %v", err)
	}
	if _, ok := res.(map[string]interface{})["dataUrl"]; !ok {
		t.Fatalf("thumb returned no dataUrl: %+v", res)
	}

	// Keychain dump must return the empty iOS-shaped structure (never panic).
	kc, err := e.androidDumpKeychain(s)
	if err != nil {
		t.Fatalf("keychain: %v", err)
	}
	counts := kc.(map[string]interface{})["counts"].(map[string]int)
	if counts["general"] != 0 || counts["keys"] != 0 {
		t.Fatalf("expected empty keychain counts, got %+v", counts)
	}
}
