package main

import (
	"database/sql"
	"io"
	"os"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/dunhamsteve/ios/backup"
	_ "modernc.org/sqlite" // pure-Go SQLite driver (no cgo → trivial cross-compile)
)

// cocoaEpoch is the offset between the Cocoa/Core Data reference date
// (2001-01-01 UTC) and the Unix epoch, in seconds.
const cocoaEpoch = 978307200.0

// cocoaToISO converts a Core Data timestamp (seconds since 2001) to ISO-8601.
func cocoaToISO(secondsSince2001 float64) string {
	if secondsSince2001 == 0 {
		return ""
	}
	return time.Unix(int64(secondsSince2001+cocoaEpoch), 0).UTC().Format(time.RFC3339)
}

// unixToISO converts Unix seconds to ISO-8601.
func unixToISO(sec int64) string {
	if sec <= 0 {
		return ""
	}
	return time.Unix(sec, 0).UTC().Format(time.RFC3339)
}

// messageDateToISO handles the iMessage `date` column, which is nanoseconds
// since 2001 on iOS 11+ and seconds since 2001 on older releases.
func messageDateToISO(raw int64) string {
	if raw == 0 {
		return ""
	}
	var seconds float64
	if raw > 1e12 {
		seconds = float64(raw) / 1e9 // nanoseconds
	} else {
		seconds = float64(raw) // seconds
	}
	return cocoaToISO(seconds)
}

// ── record lookup ────────────────────────────────────────────────────────────

// findRecord returns the first file record whose Path matches pathSuffix
// (exact or suffix), optionally constrained to a domain suffix. iOS moves some
// databases between domains across versions, so matching on the path suffix is
// more robust than a hard-coded domain.
func findRecord(mb *backup.MobileBackup, domainSuffix, pathSuffix string) *backup.Record {
	for i := range mb.Records {
		rec := &mb.Records[i]
		if rec.Length == 0 {
			continue
		}
		if !strings.HasSuffix(rec.Path, pathSuffix) {
			continue
		}
		if domainSuffix != "" && !strings.HasSuffix(rec.Domain, domainSuffix) {
			continue
		}
		return rec
	}
	return nil
}

// openDBFromRecord decrypts a database file record to a temp file and opens it
// read-only. The returned cleanup removes the temp file.
func openDBFromRecord(mb *backup.MobileBackup, rec *backup.Record) (*sql.DB, func(), error) {
	tmp, err := os.CreateTemp("", "osfed-db-*")
	if err != nil {
		return nil, func() {}, err
	}
	tmpName := tmp.Name()
	cleanup := func() { os.Remove(tmpName) }

	r, err := mb.FileReader(*rec)
	if err != nil {
		tmp.Close()
		cleanup()
		return nil, func() {}, err
	}
	_, err = io.Copy(tmp, r)
	r.Close()
	tmp.Close()
	if err != nil {
		cleanup()
		return nil, func() {}, err
	}

	db, err := sql.Open("sqlite", tmpName)
	if err != nil {
		cleanup()
		return nil, func() {}, err
	}
	return db, func() { db.Close(); cleanup() }, nil
}

// openNamedDB finds a DB by path suffix and opens it. Returns (nil, cleanup, nil)
// when the database is not present in the backup, so callers can treat a missing
// data source as "empty" rather than an error.
func openNamedDB(mb *backup.MobileBackup, domainSuffix, pathSuffix string) (*sql.DB, func(), error) {
	rec := findRecord(mb, domainSuffix, pathSuffix)
	if rec == nil {
		return nil, func() {}, nil
	}
	return openDBFromRecord(mb, rec)
}

// ── schema helpers ──────────────────────────────────────────────────────────

func tableExists(db *sql.DB, name string) bool {
	var n int
	err := db.QueryRow(`SELECT count(*) FROM sqlite_master WHERE type='table' AND name=?`, name).Scan(&n)
	return err == nil && n > 0
}

func tableColumns(db *sql.DB, table string) map[string]bool {
	cols := map[string]bool{}
	rows, err := db.Query(`SELECT name FROM pragma_table_info('` + table + `')`)
	if err != nil {
		return cols
	}
	defer rows.Close()
	for rows.Next() {
		var n string
		if rows.Scan(&n) == nil {
			cols[n] = true
		}
	}
	return cols
}

// ── text extraction helpers ─────────────────────────────────────────────────

// longestPrintableRun returns the longest run of printable UTF-8 text in b.
// Used as a last-resort body extractor for opaque blobs.
func longestPrintableRun(b []byte) string {
	var best, cur strings.Builder
	flush := func() {
		if cur.Len() > best.Len() {
			best.Reset()
			best.WriteString(cur.String())
		}
		cur.Reset()
	}
	for len(b) > 0 {
		r, size := utf8.DecodeRune(b)
		b = b[size:]
		if r == utf8.RuneError || (r < 0x20 && r != '\n' && r != '\t' && r != '\r') {
			flush()
			continue
		}
		cur.WriteRune(r)
	}
	flush()
	return strings.TrimSpace(best.String())
}
