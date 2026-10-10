package main

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
)

// TimelineEntry mirrors the shape the React timeline expects (see
// src/types/timeline.ts). Only the sub-object matching `Type` is populated.
type TimelineEntry struct {
	ID          string     `json:"id"`
	Type        string     `json:"type"`
	Timestamp   string     `json:"timestamp"`
	ContactName string     `json:"contactName"`
	ContactID   string     `json:"contactIdentifier"`
	Message     *tlMessage `json:"message,omitempty"`
	Call        *tlCall    `json:"call,omitempty"`
	Photo       *tlPhoto   `json:"photo,omitempty"`
	Note        *tlNote    `json:"note,omitempty"`
	Browser     *tlBrowser `json:"browser,omitempty"`
}

type tlMessage struct {
	Text             string `json:"text"`
	IsFromMe         bool   `json:"isFromMe"`
	Sender           string `json:"sender"`
	MessageType      string `json:"messageType"`
	ConversationName string `json:"conversationName"`
	Service          string `json:"service"`
}
type tlCall struct {
	Direction string `json:"direction"`
	Status    string `json:"status"`
	Duration  int    `json:"duration"`
	App       string `json:"app"`
}
type tlPhoto struct {
	Filename string `json:"filename"`
	FileHash string `json:"fileHash"`
	Kind     string `json:"kind"`
	Width    int    `json:"width"`
	Height   int    `json:"height"`
	Duration int    `json:"duration"`
}
type tlNote struct {
	NoteID      int    `json:"noteId"`
	Title       string `json:"title"`
	BodyPreview string `json:"bodyPreview"`
	Body        string `json:"body"`
	Modified    string `json:"modified"`
}
type tlBrowser struct {
	URL     string `json:"url"`
	Title   string `json:"title"`
	Domain  string `json:"domain"`
	Browser string `json:"browserName"`
}

type timelineParams struct {
	Handle         string `json:"handle"`
	Limit          int    `json:"limit"`
	MessagesPerDay int    `json:"-"`
}

const (
	msgsPerConv = 400
	maxMessages = 60000
	maxPhotos   = 30000
)

func rawHandle(h string) json.RawMessage {
	return json.RawMessage(fmt.Sprintf(`{"handle":%q}`, h))
}

func (e *Engine) timeline(raw json.RawMessage) (interface{}, error) {
	var p timelineParams
	if err := decode(raw, &p); err != nil {
		return nil, err
	}
	s, err := e.get(p.Handle)
	if err != nil {
		return nil, err
	}
	if s.kind == "android" {
		return map[string]interface{}{
			"entries":  []TimelineEntry{},
			"counts":   map[string]int{"message": 0, "call": 0, "photo": 0, "note": 0, "browser": 0},
			"contacts": []interface{}{},
			"total":    0,
		}, nil
	}
	if p.Limit <= 0 {
		p.Limit = 20000
	}

	var entries []TimelineEntry
	counts := map[string]int{"message": 0, "call": 0, "photo": 0, "note": 0, "browser": 0}

	// Messages — walk conversations, cap per conversation and overall.
	if cr, err := e.listConversations(rawHandle(p.Handle)); err == nil {
		convs, _ := cr.(map[string]interface{})["conversations"].([]Conversation)
		loaded := 0
		for _, c := range convs {
			if loaded >= maxMessages {
				break
			}
			mr, err := e.getMessages(json.RawMessage(fmt.Sprintf(`{"handle":%q,"chat_id":%d,"offset":0,"limit":%d}`, p.Handle, c.ChatID, msgsPerConv)))
			if err != nil {
				continue
			}
			msgs, _ := mr.(map[string]interface{})["messages"].([]Message)
			name := c.DisplayName
			if name == "" {
				name = c.ChatIdentifier
			}
			for _, m := range msgs {
				if m.IsReaction {
					continue
				}
				entries = append(entries, TimelineEntry{
					ID: fmt.Sprintf("message:%d", m.MessageID), Type: "message", Timestamp: m.Date,
					ContactName: name, ContactID: c.ChatIdentifier,
					Message: &tlMessage{
						Text: m.Text, IsFromMe: m.IsFromMe, Sender: m.Sender,
						MessageType: m.MessageType, ConversationName: name, Service: m.Service,
					},
				})
				counts["message"]++
				loaded++
			}
		}
	}

	// Calls
	if cr, err := e.listCalls(rawHandle(p.Handle)); err == nil {
		calls, _ := cr.(map[string]interface{})["calls"].([]Call)
		for _, c := range calls {
			entries = append(entries, TimelineEntry{
				ID: fmt.Sprintf("call:%d", c.CallID), Type: "call", Timestamp: c.Date,
				ContactName: c.ContactName, ContactID: c.Address,
				Call: &tlCall{Direction: c.Direction, Status: c.Status, Duration: c.Duration, App: c.App},
			})
			counts["call"]++
		}
	}

	// Photos
	if pr, err := e.listPhotos(json.RawMessage(fmt.Sprintf(`{"handle":%q,"offset":0,"limit":%d}`, p.Handle, maxPhotos))); err == nil {
		photos, _ := pr.(map[string]interface{})["photos"].([]Photo)
		for _, ph := range photos {
			if ph.DateCreated == "" {
				continue
			}
			entries = append(entries, TimelineEntry{
				ID: "photo:" + ph.UUID, Type: "photo", Timestamp: ph.DateCreated,
				Photo: &tlPhoto{Filename: ph.Filename, FileHash: ph.FileHash, Kind: ph.Kind, Duration: ph.Duration},
			})
			counts["photo"]++
		}
	}

	// Notes
	if nr, err := e.listNotes(rawHandle(p.Handle)); err == nil {
		notes, _ := nr.(map[string]interface{})["notes"].([]Note)
		for _, n := range notes {
			ts := n.Created
			if ts == "" {
				ts = n.Modified
			}
			preview := n.Body
			if len(preview) > 140 {
				preview = preview[:140]
			}
			entries = append(entries, TimelineEntry{
				ID: fmt.Sprintf("note:%d", n.NoteID), Type: "note", Timestamp: ts,
				Note: &tlNote{NoteID: n.NoteID, Title: n.Title, BodyPreview: strings.TrimSpace(preview), Body: n.Body, Modified: n.Modified},
			})
			counts["note"]++
		}
	}

	// Safari
	for _, v := range safariVisits(s.mb) {
		entries = append(entries, TimelineEntry{
			ID: "browser:" + v.VisitID, Type: "browser", Timestamp: v.VisitDate,
			Browser: &tlBrowser{URL: v.URL, Title: v.Title, Domain: v.Domain, Browser: v.Browser},
		})
		counts["browser"]++
	}

	// Sort newest first; entries without a timestamp sink to the bottom.
	sort.SliceStable(entries, func(i, j int) bool { return entries[i].Timestamp > entries[j].Timestamp })
	if len(entries) > p.Limit {
		entries = entries[:p.Limit]
	}

	// Contacts for name resolution in the UI.
	var contacts []Contact
	if cr, err := e.listContacts(rawHandle(p.Handle)); err == nil {
		contacts, _ = cr.(map[string]interface{})["contacts"].([]Contact)
	}

	return map[string]interface{}{"entries": entries, "counts": counts, "contacts": contacts, "total": len(entries)}, nil
}
