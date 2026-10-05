package main

import (
	"bytes"
	"compress/gzip"
	"encoding/binary"
	"io"
	"strings"
	"unicode/utf8"
)

// decodeAttributedBody extracts the plain text from an iMessage
// `message.attributedBody` blob. That column is a legacy `streamtyped`
// NSArchiver stream; the display text is a length-prefixed string that follows
// the "NSString"/"NSMutableString" class marker and a '+' (0x2b) tag. This is a
// pragmatic extractor (not a full typedstream parser) that covers the common
// case and falls back to the longest printable run.
func decodeAttributedBody(blob []byte) string {
	if len(blob) == 0 {
		return ""
	}
	marker := bytes.Index(blob, []byte("NSString"))
	if marker >= 0 {
		// Find the '+' tag that introduces the string bytes.
		plus := bytes.IndexByte(blob[marker:], 0x2b)
		if plus >= 0 {
			p := marker + plus + 1
			if p < len(blob) {
				var length int
				b0 := blob[p]
				switch {
				case b0 == 0x81 && p+2 < len(blob):
					length = int(binary.LittleEndian.Uint16(blob[p+1 : p+3]))
					p += 3
				case b0 == 0x82 && p+4 < len(blob):
					length = int(binary.LittleEndian.Uint32(blob[p+1 : p+5]))
					p += 5
				case b0 < 0x80:
					length = int(b0)
					p++
				default:
					length = 0
				}
				if length > 0 && p+length <= len(blob) {
					s := blob[p : p+length]
					if utf8.Valid(s) {
						return strings.TrimSpace(string(s))
					}
				}
			}
		}
	}
	return longestPrintableRun(blob)
}

// decodeNoteData extracts best-effort plain text from an Apple Notes
// ZICNOTEDATA.ZDATA blob (gzip-compressed protobuf). It gunzips the blob then
// harvests the longest printable string field from the protobuf.
func decodeNoteData(blob []byte) string {
	if len(blob) == 0 {
		return ""
	}
	data := blob
	if len(blob) > 2 && blob[0] == 0x1f && blob[1] == 0x8b {
		if gz, err := gzip.NewReader(bytes.NewReader(blob)); err == nil {
			if out, err := io.ReadAll(gz); err == nil {
				data = out
			}
			gz.Close()
		}
	}
	strs := harvestProtoStrings(data, 0)
	best := ""
	for _, s := range strs {
		t := strings.TrimSpace(s)
		if len(t) > len(best) {
			best = t
		}
	}
	if best == "" {
		return longestPrintableRun(data)
	}
	return best
}

// harvestProtoStrings walks a protobuf buffer collecting length-delimited
// fields that look like UTF-8 text, recursing into nested messages.
func harvestProtoStrings(b []byte, depth int) []string {
	var out []string
	if depth > 6 {
		return out
	}
	for len(b) > 0 {
		tag, n := binary.Uvarint(b)
		if n <= 0 {
			break
		}
		b = b[n:]
		wire := tag & 7
		switch wire {
		case 0: // varint
			_, m := binary.Uvarint(b)
			if m <= 0 {
				return out
			}
			b = b[m:]
		case 1: // 64-bit
			if len(b) < 8 {
				return out
			}
			b = b[8:]
		case 5: // 32-bit
			if len(b) < 4 {
				return out
			}
			b = b[4:]
		case 2: // length-delimited
			l, m := binary.Uvarint(b)
			if m <= 0 {
				return out
			}
			b = b[m:]
			if int(l) > len(b) {
				return out
			}
			chunk := b[:l]
			b = b[l:]
			if looksLikeText(chunk) {
				out = append(out, string(chunk))
			} else {
				out = append(out, harvestProtoStrings(chunk, depth+1)...)
			}
		default:
			return out
		}
	}
	return out
}

func looksLikeText(b []byte) bool {
	if len(b) < 2 || !utf8.Valid(b) {
		return false
	}
	printable := 0
	for _, r := range string(b) {
		if r == '\n' || r == '\r' || r == '\t' || (r >= 0x20 && r != 0x7f) {
			printable++
		}
	}
	return printable*100 >= len([]rune(string(b)))*85
}
