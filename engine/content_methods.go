package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/url"
	"path"
	"sort"
	"strings"

	"github.com/dunhamsteve/ios/backup"
)

type handleParam struct {
	Handle string `json:"handle"`
}

func (e *Engine) sessionFrom(raw json.RawMessage) (*session, error) {
	var p handleParam
	if err := decode(raw, &p); err != nil {
		return nil, err
	}
	return e.get(p.Handle)
}

// ── Messages ────────────────────────────────────────────────────────────────

type Conversation struct {
	ChatID          int    `json:"chat_id"`
	ChatIdentifier  string `json:"chat_identifier"`
	DisplayName     string `json:"display_name"`
	Service         string `json:"service"`
	MessageCount    int    `json:"message_count"`
	LastMessageDate string `json:"last_message_date"`
}

func (e *Engine) listConversations(raw json.RawMessage) (interface{}, error) {
	s, err := e.sessionFrom(raw)
	if err != nil {
		return nil, err
	}
	db, cleanup, err := openNamedDB(s.mb, "", "Library/SMS/sms.db")
	if err != nil {
		return nil, err
	}
	defer cleanup()
	if db == nil {
		return map[string]interface{}{"conversations": []Conversation{}}, nil
	}

	rows, err := db.Query(`
		SELECT c.ROWID, c.chat_identifier, COALESCE(c.display_name,''), COALESCE(c.service_name,''),
		  (SELECT COUNT(*) FROM chat_message_join cmj WHERE cmj.chat_id=c.ROWID) AS cnt,
		  (SELECT MAX(m.date) FROM message m JOIN chat_message_join j ON j.message_id=m.ROWID WHERE j.chat_id=c.ROWID) AS last
		FROM chat c ORDER BY last DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var convs []Conversation
	for rows.Next() {
		var c Conversation
		var ci, dn, svc sql.NullString
		var last sql.NullInt64
		if err := rows.Scan(&c.ChatID, &ci, &dn, &svc, &c.MessageCount, &last); err != nil {
			continue
		}
		c.ChatIdentifier = ci.String
		c.DisplayName = dn.String
		c.Service = svc.String
		if last.Valid {
			c.LastMessageDate = messageDateToISO(last.Int64)
		}
		convs = append(convs, c)
	}
	return map[string]interface{}{"conversations": convs}, nil
}

type Message struct {
	MessageID   int    `json:"message_id"`
	Text        string `json:"text"`
	Date        string `json:"date"`
	IsFromMe    bool   `json:"is_from_me"`
	Sender      string `json:"sender"`
	Service     string `json:"service"`
	MessageType string `json:"message_type"`
	IsReaction  bool   `json:"is_reaction"`
}

func messageFields(cols map[string]bool) (string, bool, bool) {
	fields := []string{"m.ROWID", "m.text", "m.date", "m.is_from_me", "COALESCE(m.service,'')", "COALESCE(h.id,'')"}
	hasAttr := cols["attributedBody"]
	if hasAttr {
		fields = append(fields, "m.attributedBody")
	}
	hasAssoc := cols["associated_message_type"]
	if hasAssoc {
		fields = append(fields, "COALESCE(m.associated_message_type,0)")
	}
	return strings.Join(fields, ", "), hasAttr, hasAssoc
}

func scanMessages(rows *sql.Rows, hasAttr, hasAssoc bool) []Message {
	var out []Message
	for rows.Next() {
		var id int
		var text sql.NullString
		var date sql.NullInt64
		var fromMe sql.NullInt64
		var service, handle sql.NullString
		var attr []byte
		var assoc sql.NullInt64

		dest := []interface{}{&id, &text, &date, &fromMe, &service, &handle}
		if hasAttr {
			dest = append(dest, &attr)
		}
		if hasAssoc {
			dest = append(dest, &assoc)
		}
		if err := rows.Scan(dest...); err != nil {
			continue
		}

		body := text.String
		if strings.TrimSpace(body) == "" && len(attr) > 0 {
			body = decodeAttributedBody(attr)
		}
		m := Message{
			MessageID:   id,
			Text:        body,
			Date:        messageDateToISO(date.Int64),
			IsFromMe:    fromMe.Int64 == 1,
			Service:     service.String,
			MessageType: "text",
			IsReaction:  assoc.Int64 >= 2000 && assoc.Int64 < 4000,
		}
		if m.IsFromMe {
			m.Sender = "Me"
		} else {
			m.Sender = handle.String
		}
		out = append(out, m)
	}
	return out
}

type getMessagesParams struct {
	Handle string `json:"handle"`
	ChatID int    `json:"chat_id"`
	Offset int    `json:"offset"`
	Limit  int    `json:"limit"`
}

func (e *Engine) getMessages(raw json.RawMessage) (interface{}, error) {
	var p getMessagesParams
	if err := decode(raw, &p); err != nil {
		return nil, err
	}
	s, err := e.get(p.Handle)
	if err != nil {
		return nil, err
	}
	if p.Limit <= 0 {
		p.Limit = 500
	}
	db, cleanup, err := openNamedDB(s.mb, "", "Library/SMS/sms.db")
	if err != nil {
		return nil, err
	}
	defer cleanup()
	if db == nil {
		return map[string]interface{}{"messages": []Message{}, "total": 0, "next_offset": 0}, nil
	}

	cols := tableColumns(db, "message")
	sel, hasAttr, hasAssoc := messageFields(cols)

	var total int
	db.QueryRow(`SELECT COUNT(*) FROM chat_message_join WHERE chat_id=?`, p.ChatID).Scan(&total)

	q := fmt.Sprintf(`SELECT %s FROM message m
		JOIN chat_message_join cmj ON cmj.message_id=m.ROWID
		LEFT JOIN handle h ON m.handle_id=h.ROWID
		WHERE cmj.chat_id=? ORDER BY m.date ASC LIMIT ? OFFSET ?`, sel)
	rows, err := db.Query(q, p.ChatID, p.Limit, p.Offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	msgs := scanMessages(rows, hasAttr, hasAssoc)
	return map[string]interface{}{"messages": msgs, "total": total, "next_offset": p.Offset + len(msgs)}, nil
}

// ── Calls ───────────────────────────────────────────────────────────────────

type Call struct {
	CallID      int    `json:"call_id"`
	Address     string `json:"address"`
	ContactName string `json:"contact_name"`
	Date        string `json:"date"`
	Duration    int    `json:"duration"`
	Direction   string `json:"direction"`
	Status      string `json:"status"`
	App         string `json:"app"`
}

func (e *Engine) listCalls(raw json.RawMessage) (interface{}, error) {
	s, err := e.sessionFrom(raw)
	if err != nil {
		return nil, err
	}
	db, cleanup, err := openNamedDB(s.mb, "", "Library/CallHistoryDB/CallHistory.storedata")
	if err != nil {
		return nil, err
	}
	defer cleanup()
	if db == nil {
		return map[string]interface{}{"calls": []Call{}}, nil
	}

	var calls []Call
	if tableExists(db, "ZCALLRECORD") {
		cols := tableColumns(db, "ZCALLRECORD")
		sel := []string{"Z_PK", "COALESCE(ZADDRESS,'')", "ZDATE", "COALESCE(ZDURATION,0)"}
		sel = append(sel, boolCol(cols, "ZORIGINATED"), boolCol(cols, "ZANSWERED"), textCol(cols, "ZSERVICE_PROVIDER"))
		rows, err := db.Query(`SELECT ` + strings.Join(sel, ", ") + ` FROM ZCALLRECORD ORDER BY ZDATE DESC`)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		for rows.Next() {
			var id int
			var addr []byte
			var zdate sql.NullFloat64
			var dur sql.NullFloat64
			var orig, ans sql.NullInt64
			var provider sql.NullString
			if err := rows.Scan(&id, &addr, &zdate, &dur, &orig, &ans, &provider); err != nil {
				continue
			}
			c := Call{
				CallID:   id,
				Address:  string(addr),
				Date:     cocoaToISO(zdate.Float64),
				Duration: int(dur.Float64),
				App:      provider.String,
			}
			if orig.Int64 == 1 {
				c.Direction = "outgoing"
			} else {
				c.Direction = "incoming"
			}
			if c.Direction == "incoming" && ans.Int64 == 0 && c.Duration == 0 {
				c.Status = "missed"
			} else {
				c.Status = "answered"
			}
			calls = append(calls, c)
		}
	} else if tableExists(db, "call") {
		rows, err := db.Query(`SELECT ROWID, COALESCE(address,''), date, COALESCE(duration,0), COALESCE(flags,0) FROM call ORDER BY date DESC`)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		for rows.Next() {
			var id int
			var addr string
			var date, dur, flags sql.NullInt64
			if err := rows.Scan(&id, &addr, &date, &dur, &flags); err != nil {
				continue
			}
			c := Call{CallID: id, Address: addr, Date: unixToISO(date.Int64), Duration: int(dur.Int64)}
			if flags.Int64&0x1 != 0 {
				c.Direction = "outgoing"
			} else {
				c.Direction = "incoming"
			}
			c.Status = "answered"
			calls = append(calls, c)
		}
	}
	return map[string]interface{}{"calls": calls}, nil
}

func boolCol(cols map[string]bool, name string) string {
	if cols[name] {
		return "COALESCE(" + name + ",0)"
	}
	return "0"
}
func textCol(cols map[string]bool, name string) string {
	if cols[name] {
		return "COALESCE(" + name + ",'')"
	}
	return "''"
}

// ── Contacts ──────────────────────────────────────────────────────────────

type Contact struct {
	Name         string   `json:"name"`
	Organization string   `json:"organization"`
	Phones       []string `json:"phones"`
	Emails       []string `json:"emails"`
}

func (e *Engine) listContacts(raw json.RawMessage) (interface{}, error) {
	s, err := e.sessionFrom(raw)
	if err != nil {
		return nil, err
	}
	db, cleanup, err := openNamedDB(s.mb, "", "Library/AddressBook/AddressBook.sqlitedb")
	if err != nil {
		return nil, err
	}
	defer cleanup()
	if db == nil || !tableExists(db, "ABPerson") {
		return map[string]interface{}{"contacts": []Contact{}}, nil
	}

	phones := multiValues(db, 3)
	emails := multiValues(db, 4)

	rows, err := db.Query(`SELECT ROWID, COALESCE(First,''), COALESCE(Last,''), COALESCE(Organization,'') FROM ABPerson`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var contacts []Contact
	for rows.Next() {
		var id int
		var first, last, org string
		if err := rows.Scan(&id, &first, &last, &org); err != nil {
			continue
		}
		name := strings.TrimSpace(strings.TrimSpace(first + " " + last))
		if name == "" {
			name = org
		}
		contacts = append(contacts, Contact{
			Name: name, Organization: org,
			Phones: phones[id], Emails: emails[id],
		})
	}
	sort.Slice(contacts, func(i, j int) bool { return contacts[i].Name < contacts[j].Name })
	return map[string]interface{}{"contacts": contacts}, nil
}

func multiValues(db *sql.DB, property int) map[int][]string {
	out := map[int][]string{}
	rows, err := db.Query(`SELECT record_id, COALESCE(value,'') FROM ABMultiValue WHERE property=?`, property)
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var rid int
		var val string
		if rows.Scan(&rid, &val) == nil && val != "" {
			out[rid] = append(out[rid], val)
		}
	}
	return out
}

// ── Notes ───────────────────────────────────────────────────────────────────

type Note struct {
	NoteID   int    `json:"note_id"`
	Title    string `json:"title"`
	Body     string `json:"body"`
	Folder   string `json:"folder"`
	Created  string `json:"created"`
	Modified string `json:"modified"`
}

func (e *Engine) listNotes(raw json.RawMessage) (interface{}, error) {
	s, err := e.sessionFrom(raw)
	if err != nil {
		return nil, err
	}
	db, cleanup, err := openNamedDB(s.mb, "", "NoteStore.sqlite")
	if err != nil {
		return nil, err
	}
	defer cleanup()
	if db == nil {
		return map[string]interface{}{"notes": []Note{}}, nil
	}

	var notes []Note
	if tableExists(db, "ZICCLOUDSYNCINGOBJECT") {
		cols := tableColumns(db, "ZICCLOUDSYNCINGOBJECT")
		created := firstCol(cols, "ZCREATIONDATE1", "ZCREATIONDATE", "ZCREATIONDATE3")
		modified := firstCol(cols, "ZMODIFICATIONDATE1", "ZMODIFICATIONDATE", "ZMODIFICATIONDATE3")
		q := fmt.Sprintf(`SELECT n.Z_PK, COALESCE(n.ZTITLE1,''), %s, %s, d.ZDATA
			FROM ZICCLOUDSYNCINGOBJECT n
			LEFT JOIN ZICNOTEDATA d ON d.ZNOTE=n.Z_PK
			WHERE n.ZTITLE1 IS NOT NULL`,
			nullCocoa(created, "cdate"), nullCocoa(modified, "mdate"))
		rows, err := db.Query(q)
		if err == nil {
			defer rows.Close()
			for rows.Next() {
				var id int
				var title string
				var cdate, mdate sql.NullFloat64
				var data []byte
				if err := rows.Scan(&id, &title, &cdate, &mdate, &data); err != nil {
					continue
				}
				notes = append(notes, Note{
					NoteID: id, Title: title, Body: decodeNoteData(data),
					Created: cocoaToISO(cdate.Float64), Modified: cocoaToISO(mdate.Float64),
				})
			}
		}
	} else if tableExists(db, "ZNOTE") {
		rows, err := db.Query(`SELECT n.Z_PK, COALESCE(n.ZTITLE,''), COALESCE(n.ZCREATIONDATE,0), COALESCE(n.ZMODIFICATIONDATE,0), COALESCE(nb.ZCONTENT,'')
			FROM ZNOTE n LEFT JOIN ZNOTEBODY nb ON nb.ZNOTE=n.Z_PK`)
		if err == nil {
			defer rows.Close()
			for rows.Next() {
				var id int
				var title, content string
				var cdate, mdate sql.NullFloat64
				if err := rows.Scan(&id, &title, &cdate, &mdate, &content); err != nil {
					continue
				}
				notes = append(notes, Note{
					NoteID: id, Title: title, Body: stripHTML(content),
					Created: cocoaToISO(cdate.Float64), Modified: cocoaToISO(mdate.Float64),
				})
			}
		}
	}
	return map[string]interface{}{"notes": notes}, nil
}

func firstCol(cols map[string]bool, names ...string) string {
	for _, n := range names {
		if cols[n] {
			return n
		}
	}
	return ""
}
func nullCocoa(col, alias string) string {
	if col == "" {
		return "0 AS " + alias
	}
	return "COALESCE(n." + col + ",0) AS " + alias
}
func stripHTML(s string) string {
	// crude tag stripper for legacy ZNOTEBODY html
	var b strings.Builder
	in := false
	for _, r := range s {
		switch r {
		case '<':
			in = true
		case '>':
			in = false
		default:
			if !in {
				b.WriteRune(r)
			}
		}
	}
	return strings.TrimSpace(b.String())
}

// ── Safari / browser history ─────────────────────────────────────────────────

type Visit struct {
	VisitID    string `json:"visit_id"`
	URL        string `json:"url"`
	Title      string `json:"title"`
	Domain     string `json:"domain"`
	VisitDate  string `json:"visit_date"`
	Browser    string `json:"browser"`
	VisitCount int    `json:"visit_count"`
}

func (e *Engine) listBrowserHistory(raw json.RawMessage) (interface{}, error) {
	s, err := e.sessionFrom(raw)
	if err != nil {
		return nil, err
	}
	visits := safariVisits(s.mb)
	return map[string]interface{}{"visits": visits}, nil
}

func (e *Engine) hasBrowserHistory(raw json.RawMessage) (interface{}, error) {
	s, err := e.sessionFrom(raw)
	if err != nil {
		return nil, err
	}
	return map[string]interface{}{"has_any": findRecord(s.mb, "", "Library/Safari/History.db") != nil}, nil
}

func safariVisits(mb *backup.MobileBackup) []Visit {
	db, cleanup, err := openNamedDB(mb, "", "Library/Safari/History.db")
	if err != nil || db == nil {
		return []Visit{}
	}
	defer cleanup()
	if !tableExists(db, "history_items") {
		return []Visit{}
	}
	rows, err := db.Query(`
		SELECT hi.id, COALESCE(hi.url,''), COALESCE(hi.visit_count,0),
		  (SELECT COALESCE(v.title,'') FROM history_visits v WHERE v.history_item=hi.id ORDER BY v.visit_time DESC LIMIT 1) AS title,
		  (SELECT MAX(v.visit_time) FROM history_visits v WHERE v.history_item=hi.id) AS vt
		FROM history_items hi ORDER BY vt DESC`)
	if err != nil {
		return []Visit{}
	}
	defer rows.Close()
	var out []Visit
	for rows.Next() {
		var id int
		var u, title string
		var vc int
		var vt sql.NullFloat64
		if err := rows.Scan(&id, &u, &vc, &title, &vt); err != nil {
			continue
		}
		dom := ""
		if pu, err := url.Parse(u); err == nil {
			dom = pu.Host
		}
		out = append(out, Visit{
			VisitID: fmt.Sprintf("safari:%d", id), URL: u, Title: title, Domain: dom,
			VisitDate: cocoaToISO(vt.Float64), Browser: "safari", VisitCount: vc,
		})
	}
	return out
}

// ── Photos (file enumeration from CameraRollDomain) ──────────────────────────

type Photo struct {
	UUID        string `json:"uuid"`
	Filename    string `json:"filename"`
	FileHash    string `json:"file_hash"`
	Kind        string `json:"kind"`
	Width       int    `json:"width"`
	Height      int    `json:"height"`
	Duration    int    `json:"duration"`
	DateCreated string `json:"date_created"`
	Bytes       int64  `json:"bytes"`
	RelPath     string `json:"rel_path"`
}

var photoExts = map[string]string{
	".jpg": "photo", ".jpeg": "photo", ".png": "photo", ".heic": "photo", ".heif": "photo",
	".gif": "photo", ".webp": "photo", ".tiff": "photo", ".dng": "photo", ".bmp": "photo",
	".mov": "video", ".mp4": "video", ".m4v": "video", ".avi": "video",
}

type listPhotosParams struct {
	Handle string `json:"handle"`
	Offset int    `json:"offset"`
	Limit  int    `json:"limit"`
}

func (e *Engine) listPhotos(raw json.RawMessage) (interface{}, error) {
	var p listPhotosParams
	if err := decode(raw, &p); err != nil {
		return nil, err
	}
	s, err := e.get(p.Handle)
	if err != nil {
		return nil, err
	}
	if p.Limit <= 0 {
		p.Limit = 100000
	}

	var all []Photo
	for i := range s.mb.Records {
		rec := &s.mb.Records[i]
		if rec.Length == 0 || !strings.HasSuffix(rec.Domain, "CameraRollDomain") {
			continue
		}
		ext := strings.ToLower(path.Ext(rec.Path))
		kind, ok := photoExts[ext]
		if !ok {
			continue
		}
		all = append(all, Photo{
			UUID:        rec.HashCode(),
			Filename:    path.Base(rec.Path),
			FileHash:    rec.HashCode(),
			Kind:        kind,
			DateCreated: unixToISO(int64(rec.Mtime)),
			Bytes:       int64(rec.Length),
			RelPath:     rec.Path,
		})
	}
	sort.Slice(all, func(i, j int) bool { return all[i].DateCreated > all[j].DateCreated })
	total := len(all)
	end := p.Offset + p.Limit
	if p.Offset > total {
		p.Offset = total
	}
	if end > total {
		end = total
	}
	return map[string]interface{}{"photos": all[p.Offset:end], "total": total}, nil
}
