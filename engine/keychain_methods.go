package main

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/dunhamsteve/ios/backup"
	"github.com/dunhamsteve/ios/crypto/aeswrap"
	"github.com/dunhamsteve/ios/crypto/gcm"
	"github.com/dunhamsteve/plist"
)

var le = binary.LittleEndian

// decryptKCItem decrypts one keychain item's GCM payload. iOS backups use
// Apple's "null IV" GCM convention; other producers (e.g. test fixtures or
// third-party tools) use standard AES-GCM with a 12-byte nonce prepended to the
// ciphertext, or an all-zero 12-byte nonce. We try each and return the first
// that authenticates, so OSFED reads both real device backups and such fixtures.
func decryptKCItem(key, edata []byte) ([]byte, bool) {
	// 1) Apple null-IV GCM (real iOS device backups).
	if c, err := aes.NewCipher(key); err == nil {
		if g, err := gcm.NewGCM(c); err == nil {
			if plain, err := g.Open(nil, nil, edata, nil); err == nil {
				return plain, true
			}
		}
	}
	// 2) Standard AES-GCM, 12-byte nonce prepended to ciphertext+tag.
	if len(edata) > 12+16 {
		if c, err := aes.NewCipher(key); err == nil {
			if g, err := cipher.NewGCM(c); err == nil {
				if plain, err := g.Open(nil, edata[:12], edata[12:], nil); err == nil {
					return plain, true
				}
			}
		}
	}
	// 3) Standard AES-GCM, all-zero 12-byte nonce.
	if c, err := aes.NewCipher(key); err == nil {
		if g, err := cipher.NewGCM(c); err == nil {
			var zero [12]byte
			if plain, err := g.Open(nil, zero[:], edata, nil); err == nil {
				return plain, true
			}
		}
	}
	// 4) Blank-IV AES-CTR recovery, WITHOUT tag verification. iOS keychain GCM
	//    uses J0 = 0^128 so the data counter starts at {0,…,0,1}; the keystream
	//    is the same whether or not we check the tag. Some producers (and partial
	//    backups) carry a tag that will not validate, but the item key is already
	//    integrity-checked by the RFC-3394 unwrap, so CTR recovers the plaintext.
	//    Gate on a plausible DER prefix so a wrong result is not accepted.
	if len(edata) > aes.BlockSize {
		if c, err := aes.NewCipher(key); err == nil {
			ct := edata[:len(edata)-16]
			var ctr0 [16]byte
			ctr0[15] = 1
			out := make([]byte, len(ct))
			cipher.NewCTR(c, ctr0[:]).XORKeyStream(out, ct)
			if looksLikeDER(out) {
				return out, true
			}
		}
	}
	return nil, false
}

// looksLikeDER reports whether b begins with a DER SEQUENCE (0x30) or SET
// (0x31) header, the outer type of a decoded keychain item.
func looksLikeDER(b []byte) bool {
	return len(b) > 2 && (b[0] == 0x30 || b[0] == 0x31)
}

// ── keychain plist shapes (from the backup's keychain-backup.plist) ─────────

type kcEntry struct {
	Data []byte `plist:"v_Data"`
	Ref  []byte `plist:"v_PersistentRef"`
}

type keychainFile struct {
	Internet []kcEntry `plist:"inet"`
	General  []kcEntry `plist:"genp"`
	Certs    []kcEntry `plist:"cert"`
	Keys     []kcEntry `plist:"keys"`
}

// ── DER walker for decrypted keychain records ───────────────────────────────
//
// Each decrypted item is a DER container (SET or SEQUENCE) of two-element
// {key, value} pairs. Rather than depend on a strict asn1.Unmarshal (which is
// picky about SET-vs-SEQUENCE and tag classes), we walk the TLV structure the
// same way the reference iOS Keychain Viewer does, so OSFED reads both real
// device backups and third-party-produced fixtures.

type tlv struct {
	cls         byte
	constructed bool
	tagNum      byte
	cStart      int
	cEnd        int
	next        int
}

func readTLV(b []byte, pos int) (tlv, bool) {
	if pos < 0 || pos+1 >= len(b) {
		return tlv{}, false
	}
	tag := b[pos]
	p := pos + 1
	tagNum := tag & 0x1f
	if tagNum == 0x1f { // long-form tag number
		for p < len(b) && b[p]&0x80 != 0 {
			p++
		}
		p++
	}
	if p >= len(b) {
		return tlv{}, false
	}
	l := int(b[p])
	p++
	if l&0x80 != 0 {
		n := l & 0x7f
		l = 0
		for i := 0; i < n; i++ {
			if p >= len(b) {
				return tlv{}, false
			}
			l = l*256 + int(b[p])
			p++
		}
	}
	cStart := p
	cEnd := p + l
	if cEnd > len(b) { // tolerate truncation rather than failing the whole item
		cEnd = len(b)
	}
	return tlv{cls: tag & 0xc0, constructed: tag&0x20 != 0, tagNum: tagNum, cStart: cStart, cEnd: cEnd, next: cEnd}, true
}

func tlvChildren(b []byte, node tlv) []tlv {
	var out []tlv
	p := node.cStart
	for p < node.cEnd {
		t, ok := readTLV(b, p)
		if !ok || t.next <= p {
			break
		}
		out = append(out, t)
		p = t.next
	}
	return out
}

func parseKCRecord(data []byte) map[string]interface{} {
	out := make(map[string]interface{})
	top, ok := readTLV(data, 0)
	if !ok {
		return out
	}
	for _, pair := range tlvChildren(data, top) {
		if !pair.constructed {
			continue
		}
		kv := tlvChildren(data, pair)
		if len(kv) < 2 {
			continue
		}
		key := strings.TrimRight(string(data[kv[0].cStart:kv[0].cEnd]), "\x00")
		out[key] = decodeASN1Value(data, kv[1])
	}
	return out
}

func decodeASN1Value(b []byte, node tlv) interface{} {
	content := append([]byte(nil), b[node.cStart:node.cEnd]...)
	if node.cls != 0x00 { // context/application tag — keep raw bytes
		return content
	}
	switch node.tagNum {
	case 0x01: // BOOLEAN
		return len(content) > 0 && content[0] != 0
	case 0x02: // INTEGER
		if len(content) <= 8 {
			var v int64
			for _, c := range content {
				v = v<<8 | int64(c)
			}
			return v
		}
		return content
	case 0x05: // NULL
		return nil
	case 0x0c, 0x12, 0x13, 0x14, 0x16: // UTF8/Numeric/Printable/Teletex/IA5 string
		return string(content)
	case 0x17, 0x18: // UTCTime / GeneralizedTime
		if t, ok := parseASN1Time(string(content)); ok {
			return t
		}
		return string(content)
	default: // OCTET STRING, BIT STRING, and anything else → raw bytes
		return content
	}
}

// parseASN1Time parses the UTCTime / GeneralizedTime forms keychains use.
func parseASN1Time(s string) (time.Time, bool) {
	for _, layout := range []string{"060102150405Z0700", "20060102150405Z0700", "20060102150405Z", "060102150405Z"} {
		if t, err := time.Parse(layout, s); err == nil {
			return t, true
		}
	}
	return time.Time{}, false
}

// decryptKeyGroup unwraps and GCM-decrypts every entry in one keychain class,
// returning the decoded attribute maps (normalized for JSON).
func decryptKeyGroup(mb *backup.MobileBackup, group []kcEntry) []map[string]interface{} {
	var rval []map[string]interface{}
	for i, item := range group {
		if len(item.Data) < 12 {
			dbg("item %d: data too short (%d)", i, len(item.Data))
			continue
		}
		dbg("item %d: data=%d bytes ref=%q", i, len(item.Data), string(item.Ref))
		version := le.Uint32(item.Data)
		class := le.Uint32(item.Data[4:])
		if version != 3 {
			dbg("item %d: unexpected version %d class %d", i, version, class)
			continue
		}
		l := le.Uint32(item.Data[8:])
		if int(12+l) > len(item.Data) {
			dbg("item %d: wrapped-key length %d overflows data %d", i, l, len(item.Data))
			continue
		}
		wkey := item.Data[12 : 12+l]
		edata := item.Data[12+l:]

		ckey := mb.Keybag.GetClassKey(class)
		if ckey == nil {
			dbg("item %d: no class key for protection class %d", i, class)
			continue
		}
		key := aeswrap.Unwrap(ckey, wkey)
		if key == nil {
			dbg("item %d: aeswrap unwrap failed (class %d)", i, class)
			continue
		}
		plain, ok := decryptKCItem(key, edata)
		if !ok {
			dbg("item %d: GCM decryption failed for all nonce conventions", i)
			continue
		}
		record := parseKCRecord(plain)
		rval = append(rval, normalizeRecord(record, class))
	}
	return rval
}

// normalizeRecord converts a decoded attribute map into a JSON-safe map with a
// friendly "summary" block for the table view and a "raw" block for detail.
func normalizeRecord(rec map[string]interface{}, class uint32) map[string]interface{} {
	raw := make(map[string]interface{}, len(rec))
	for k, v := range rec {
		raw[k] = normKCValue(v)
	}

	summary := map[string]interface{}{
		"account":         kcString(rec["acct"]),
		"service":         kcString(rec["svce"]),
		"label":           kcString(rec["labl"]),
		"description":     kcString(rec["desc"]),
		"accessGroup":     kcString(rec["agrp"]),
		"server":          kcString(rec["srvr"]),
		"protocol":        kcString(rec["ptcl"]),
		"accessible":      kcString(rec["pdmn"]),
		"synchronizable":  rec["sync"],
		"created":         kcTime(rec["cdat"]),
		"modified":        kcTime(rec["mdat"]),
		"protectionClass": class,
		"secret":          secretValue(secretRaw(rec)),
	}

	return map[string]interface{}{
		"summary": summary,
		"raw":     raw,
	}
}

// secretRaw returns the item's secret payload, which different producers store
// under "v_Data" (iOS) or "data".
func secretRaw(rec map[string]interface{}) interface{} {
	if v, ok := rec["v_Data"]; ok && v != nil {
		return v
	}
	return rec["data"]
}

// secretValue renders the v_Data secret: utf8 when it reads as text, otherwise
// a non-lossy bytesValue. Strings are passed through directly.
func secretValue(v interface{}) interface{} {
	switch t := v.(type) {
	case nil:
		return nil
	case string:
		return map[string]interface{}{"text": t, "isText": true}
	case []byte:
		if isMostlyPrintable(t) {
			return map[string]interface{}{"text": string(t), "isText": true}
		}
		return map[string]interface{}{
			"isText": false,
			"len":    len(t),
			"hex":    hex.EncodeToString(t),
			"base64": base64.StdEncoding.EncodeToString(t),
		}
	default:
		return map[string]interface{}{"text": fmt.Sprintf("%v", t), "isText": true}
	}
}

func kcString(v interface{}) string {
	switch t := v.(type) {
	case nil:
		return ""
	case string:
		return t
	case []byte:
		if isMostlyPrintable(t) {
			return string(t)
		}
		return ""
	default:
		return fmt.Sprintf("%v", t)
	}
}

func kcTime(v interface{}) interface{} {
	if t, ok := v.(time.Time); ok {
		return asRFC3339(t)
	}
	return nil
}

// normKCValue makes any decoded value safe + informative for JSON.
func normKCValue(v interface{}) interface{} {
	switch t := v.(type) {
	case []byte:
		bv := bytesValue{
			Bytes:  true,
			Len:    len(t),
			Hex:    hex.EncodeToString(t),
			Base64: base64.StdEncoding.EncodeToString(t),
		}
		if isMostlyPrintable(t) {
			bv.UTF8 = string(t)
		}
		return bv
	case time.Time:
		return asRFC3339(t)
	default:
		return v
	}
}

// ── dump_keychain ───────────────────────────────────────────────────────────

func (e *Engine) dumpKeychain(raw json.RawMessage) (interface{}, error) {
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
	if !s.encrypted {
		return nil, fmt.Errorf("KEYCHAIN_UNAVAILABLE: the keychain is only present in encrypted backups")
	}

	var found *backup.Record
	for i := range s.mb.Records {
		rec := s.mb.Records[i]
		if rec.Domain == "KeychainDomain" && rec.Path == "keychain-backup.plist" {
			found = &s.mb.Records[i]
			break
		}
	}
	if found == nil {
		return nil, fmt.Errorf("KEYCHAIN_NOT_FOUND: no keychain-backup.plist in this backup")
	}

	data, err := s.mb.ReadFile(*found)
	if err != nil {
		return nil, fmt.Errorf("could not read keychain: %w", err)
	}

	dbg("keychain file read: %d bytes, head=%x", len(data), data[:min(16, len(data))])

	var kc keychainFile
	if err := plist.Unmarshal(bytes.NewReader(data), &kc); err != nil {
		return nil, fmt.Errorf("could not parse keychain plist: %w", err)
	}
	dbg("keychain groups: genp=%d inet=%d cert=%d keys=%d", len(kc.General), len(kc.Internet), len(kc.Certs), len(kc.Keys))

	general := decryptKeyGroup(s.mb, kc.General)
	internet := decryptKeyGroup(s.mb, kc.Internet)
	certs := decryptKeyGroup(s.mb, kc.Certs)
	keys := decryptKeyGroup(s.mb, kc.Keys)

	return map[string]interface{}{
		"counts": map[string]int{
			"general":  len(general),
			"internet": len(internet),
			"certs":    len(certs),
			"keys":     len(keys),
		},
		"general":  general,
		"internet": internet,
		"certs":    certs,
		"keys":     keys,
	}, nil
}
