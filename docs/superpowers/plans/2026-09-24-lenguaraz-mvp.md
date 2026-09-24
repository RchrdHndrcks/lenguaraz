# Lenguaraz MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a working, deployable, open source real-time captioning server for conferences (live audio per room → original transcript + translations → web viewers) before 2026-09-25 15:00 UTC.

**Architecture:** One Go binary. Operator browsers stream 16 kHz PCM16 over WebSocket per room; each room runs a Gemini Live transcription session (`gemini-3.5-transcribe-live`), translates finalized segments with a text model, appends them to JSONL and fans them out over SSE to viewer pages (mobile / screen / OBS overlay). Frontend is plain HTML/JS embedded with `embed.FS`.

**Tech Stack:** Go 1.26, `google.golang.org/genai` v1.71.0, `github.com/coder/websocket`, `gopkg.in/yaml.v3`, vanilla JS (ES modules, AudioWorklet, EventSource), Docker + docker compose.

**Spec:** `docs/superpowers/specs/2026-09-24-lenguaraz-design.md`

## Global Constraints

- Module path: `github.com/RchrdHndrcks/lenguaraz`. Go 1.26.
- License: Apache-2.0 (`LICENSE` file at repo root).
- Supported language codes: `en`, `es`, `pt`. A room's `targets` never include its `source`.
- Audio wire format everywhere: raw little-endian PCM16, mono, 16 kHz; `asr.BytesPerSecond = 32000`; operator sends ~100 ms chunks (3200 bytes).
- Default models: ASR `gemini-3.5-transcribe-live` (env `ASR_MODEL`), translation `gemini-3.5-flash-lite` (env `TRANSLATE_MODEL`).
- Env: `GEMINI_API_KEY` (required unless `-fake`), `ADMIN_TOKEN` (guards `/operator` ingest, `/ingest/*`, `/api/admin/*`; empty = open, with a startup warning).
- `GEMINI_API_KEY` never reaches the browser.
- SSE event names: `interim` (`{"text": …}`), `final` (Segment JSON), `status` (`{"live": bool}`).
- Viewer ring buffer: last 50 finals. SSE subscriber buffer: 64 messages; slow subscribers are dropped, never block the hub.
- Commit messages: imperative, capitalized, ≤50-char subject, no conventional-commit prefixes, no attribution lines.
- UI copy is Spanish (audience is Nerdearla); code, comments and README are English.

## File Map

```
go.mod / go.sum
LICENSE                              Apache-2.0 text
rooms.yaml                           default two-room config
cmd/lenguaraz/main.go                flags, wiring, graceful shutdown
cmd/asr-smoke/main.go                stdin PCM → Gemini ASR → stdout (protocol check)
internal/caption/caption.go          Segment type
internal/config/config.go(+_test)    rooms.yaml parsing/validation
internal/store/store.go(+_test)      JSONL append/load per room
internal/export/export.go(+_test)    VTT / SRT / TXT
internal/asr/asr.go                  Engine interface, Event, Config
internal/asr/fake.go(+_test)         scripted engine
internal/asr/assemble.go(+_test)     folds Live transcription messages into events
internal/asr/gemini.go               Live session lifecycle
internal/translate/translate.go(+_test)  Translator, Prompt, Fake
internal/translate/gemini.go         text-model translator
internal/room/hub.go(+_test)         fan-out + ring buffer
internal/room/room.go(+_test)        per-room pipeline + status
internal/web/server.go(+_test)       routes, SSE, ingest WS, API, export
internal/web/static/…                index/viewer/operator/admin pages, css, js
samples/en.wav, samples/es.wav       generated TTS clips (redistributable)
samples/make-samples.sh              regenerates them
Dockerfile, docker-compose.yml, README.md
```

---

### Task 0: Publish the repo skeleton

**Files:** none new (repo already has the spec and this plan).

- [ ] **Step 1: Check which GitHub account `gh` uses**

Run: `gh auth status`
Expected: logged in as the account that owns `RchrdHndrcks` (or has rights to create repos there). If not, stop and ask the user.

- [ ] **Step 2: Commit the plan, create the public repo and push `main`**

```bash
cd ~/github.com/RchrdHndrcks/lenguaraz
git add docs/superpowers/plans docs/superpowers/specs
git commit -m "Add Lenguaraz MVP implementation plan"
gh repo create RchrdHndrcks/lenguaraz --public \
  --description "Open source real-time conference captions and translation (Gemini Live)" \
  --source . --remote origin --push
git switch -c mvp
```

Expected: repo visible at `https://github.com/RchrdHndrcks/lenguaraz`; local branch `mvp` checked out. All following tasks commit to `mvp`.

---

### Task 1: Module scaffold, Segment type and room config

**Files:**
- Create: `go.mod`, `LICENSE`, `rooms.yaml`, `internal/caption/caption.go`, `internal/config/config.go`
- Test: `internal/config/config_test.go`

**Interfaces:**
- Produces: `caption.Segment{ID int; Room string; T0, T1 float64; Lang, Text string; Translations map[string]string; Error string}` with JSON tags `id, room, t0, t1, lang, text, translations, error`; `Segment.In(lang string) string`.
- Produces: `config.Room{ID, Title, Source string; Targets, Glossary []string}`, `config.Config{Rooms []Room}`, `config.Parse([]byte) (Config, error)`, `config.Load(path string) (Config, error)`.

- [ ] **Step 1: Init module and license**

```bash
cd ~/github.com/RchrdHndrcks/lenguaraz
go mod init github.com/RchrdHndrcks/lenguaraz
go mod edit -go=1.26
curl -fsSL https://www.apache.org/licenses/LICENSE-2.0.txt -o LICENSE
head -3 LICENSE
```

Expected: LICENSE starts with "Apache License / Version 2.0, January 2004".

- [ ] **Step 2: Write `internal/caption/caption.go`**

```go
// Package caption holds the types shared across the captioning pipeline.
package caption

// Segment is one finalized caption line: the original text plus its
// translations, timed against the room's audio clock (seconds).
type Segment struct {
	ID           int               `json:"id"`
	Room         string            `json:"room"`
	T0           float64           `json:"t0"`
	T1           float64           `json:"t1"`
	Lang         string            `json:"lang"`
	Text         string            `json:"text"`
	Translations map[string]string `json:"translations,omitempty"`
	Error        string            `json:"error,omitempty"`
}

// In returns the segment text in lang, falling back to the original text
// when that translation is missing.
func (s Segment) In(lang string) string {
	if lang == s.Lang {
		return s.Text
	}
	if t := s.Translations[lang]; t != "" {
		return t
	}
	return s.Text
}
```

- [ ] **Step 3: Write the failing config test `internal/config/config_test.go`**

```go
package config

import (
	"strings"
	"testing"
)

func TestParseValid(t *testing.T) {
	c, err := Parse([]byte(`
rooms:
  - id: sala-a
    title: Keynote
    source: en
    targets: [es, pt]
    glossary: [Kubernetes, Nerdearla]
  - id: sala-b
    source: es
    targets: [en]
`))
	if err != nil {
		t.Fatal(err)
	}
	if len(c.Rooms) != 2 {
		t.Fatalf("rooms = %d, want 2", len(c.Rooms))
	}
	a := c.Rooms[0]
	if a.ID != "sala-a" || a.Title != "Keynote" || a.Source != "en" ||
		strings.Join(a.Targets, ",") != "es,pt" || len(a.Glossary) != 2 {
		t.Fatalf("room a = %+v", a)
	}
	if c.Rooms[1].Title != "sala-b" {
		t.Fatalf("missing title should default to id, got %q", c.Rooms[1].Title)
	}
}

func TestParseErrors(t *testing.T) {
	cases := map[string]string{
		"no rooms":         `rooms: []`,
		"bad id":           "rooms:\n  - id: Sala A\n    source: en\n",
		"duplicate id":     "rooms:\n  - id: a\n    source: en\n  - id: a\n    source: es\n",
		"bad source":       "rooms:\n  - id: a\n    source: fr\n",
		"bad target":       "rooms:\n  - id: a\n    source: en\n    targets: [de]\n",
		"target is source": "rooms:\n  - id: a\n    source: en\n    targets: [en]\n",
		"not yaml":         "rooms: [",
	}
	for name, in := range cases {
		t.Run(name, func(t *testing.T) {
			if _, err := Parse([]byte(in)); err == nil {
				t.Fatal("expected an error")
			}
		})
	}
}
```

- [ ] **Step 4: Run it to see it fail**

Run: `go test ./internal/config/`
Expected: FAIL (build error: `undefined: Parse`).

- [ ] **Step 5: Write `internal/config/config.go`**

```go
// Package config loads the room definitions (rooms.yaml).
package config

import (
	"errors"
	"fmt"
	"os"
	"regexp"

	"gopkg.in/yaml.v3"
)

// Room is one stage/session that receives audio and produces captions.
type Room struct {
	ID       string   `yaml:"id" json:"id"`
	Title    string   `yaml:"title" json:"title"`
	Source   string   `yaml:"source" json:"source"`
	Targets  []string `yaml:"targets" json:"targets"`
	Glossary []string `yaml:"glossary" json:"glossary,omitempty"`
}

// Config is the whole rooms.yaml file.
type Config struct {
	Rooms []Room `yaml:"rooms"`
}

var (
	idPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9-]*$`)
	languages = map[string]bool{"en": true, "es": true, "pt": true}
)

// Load reads and validates a rooms file.
func Load(path string) (Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return Config{}, fmt.Errorf("read rooms: %w", err)
	}
	return Parse(data)
}

// Parse validates rooms YAML and fills defaults (title defaults to id).
func Parse(data []byte) (Config, error) {
	var c Config
	if err := yaml.Unmarshal(data, &c); err != nil {
		return Config{}, fmt.Errorf("parse rooms: %w", err)
	}
	if len(c.Rooms) == 0 {
		return Config{}, errors.New("rooms: at least one room is required")
	}
	seen := map[string]bool{}
	for i, r := range c.Rooms {
		if !idPattern.MatchString(r.ID) {
			return Config{}, fmt.Errorf("room %d: invalid id %q (use lowercase letters, digits and dashes)", i, r.ID)
		}
		if seen[r.ID] {
			return Config{}, fmt.Errorf("room %q: duplicate id", r.ID)
		}
		seen[r.ID] = true
		if !languages[r.Source] {
			return Config{}, fmt.Errorf("room %q: unsupported source language %q", r.ID, r.Source)
		}
		for _, t := range r.Targets {
			if !languages[t] || t == r.Source {
				return Config{}, fmt.Errorf("room %q: invalid target language %q", r.ID, t)
			}
		}
		if r.Title == "" {
			c.Rooms[i].Title = r.ID
		}
	}
	return c, nil
}
```

- [ ] **Step 6: Fetch deps and run tests**

Run: `go get gopkg.in/yaml.v3 && go test ./internal/config/`
Expected: `ok  github.com/RchrdHndrcks/lenguaraz/internal/config`

- [ ] **Step 7: Write the default `rooms.yaml`**

```yaml
# Each room is one stage. `source` is the language spoken on stage;
# `targets` are the translations produced. Supported: en, es, pt.
# `glossary` terms are biased in transcription and kept as-is in translation.
rooms:
  - id: sala-a
    title: "Sala A — Keynotes"
    source: en
    targets: [es, pt]
    glossary: [Nerdearla, Kubernetes, eBPF, Gemini, Gemma, open source]
  - id: sala-b
    title: "Sala B — Charlas"
    source: es
    targets: [en]
    glossary: [Nerdearla, Konex, Kubernetes]
```

- [ ] **Step 8: Commit**

```bash
git add go.mod go.sum LICENSE rooms.yaml internal/caption internal/config
git commit -m "Add module scaffold and room configuration"
```

---

### Task 2: Transcript store and subtitle export

**Files:**
- Create: `internal/store/store.go`, `internal/export/export.go`
- Test: `internal/store/store_test.go`, `internal/export/export_test.go`

**Interfaces:**
- Consumes: `caption.Segment`.
- Produces: `store.New(dir string) (*Store, error)`, `(*Store).Append(caption.Segment) error`, `(*Store).Load(room string) ([]caption.Segment, error)` (missing file → `nil, nil`).
- Produces: `export.VTT(segs []caption.Segment, lang string) string`, `export.SRT(...)`, `export.TXT(...)`.

- [ ] **Step 1: Write the failing tests**

`internal/store/store_test.go`:

```go
package store

import (
	"testing"

	"github.com/RchrdHndrcks/lenguaraz/internal/caption"
)

func TestAppendAndLoad(t *testing.T) {
	s, err := New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if got, err := s.Load("sala-a"); err != nil || got != nil {
		t.Fatalf("empty room: got %v, %v", got, err)
	}
	want := []caption.Segment{
		{ID: 0, Room: "sala-a", T0: 0, T1: 1.5, Lang: "en", Text: "Hello.", Translations: map[string]string{"es": "Hola."}},
		{ID: 1, Room: "sala-a", T0: 1.5, T1: 3, Lang: "en", Text: "Bye.", Error: "boom"},
	}
	for _, seg := range want {
		if err := s.Append(seg); err != nil {
			t.Fatal(err)
		}
	}
	got, err := s.Load("sala-a")
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 || got[0].Translations["es"] != "Hola." || got[1].Error != "boom" || got[1].T1 != 3 {
		t.Fatalf("got %+v", got)
	}
	if other, _ := s.Load("sala-b"); other != nil {
		t.Fatalf("rooms must be isolated, got %+v", other)
	}
}
```

`internal/export/export_test.go`:

```go
package export

import (
	"testing"

	"github.com/RchrdHndrcks/lenguaraz/internal/caption"
)

var segs = []caption.Segment{
	{ID: 0, T0: 0, T1: 2.5, Lang: "en", Text: "Hello.", Translations: map[string]string{"es": "Hola."}},
	{ID: 1, T0: 2.5, T1: 3723.456, Lang: "en", Text: "Bye."},
}

func TestVTT(t *testing.T) {
	want := "WEBVTT\n\n" +
		"1\n00:00:00.000 --> 00:00:02.500\nHola.\n\n" +
		"2\n00:00:02.500 --> 01:02:03.456\nBye.\n\n"
	if got := VTT(segs, "es"); got != want {
		t.Fatalf("got:\n%q\nwant:\n%q", got, want)
	}
}

func TestSRT(t *testing.T) {
	want := "1\n00:00:00,000 --> 00:00:02,500\nHello.\n\n" +
		"2\n00:00:02,500 --> 01:02:03,456\nBye.\n\n"
	if got := SRT(segs, "en"); got != want {
		t.Fatalf("got:\n%q\nwant:\n%q", got, want)
	}
}

func TestTXT(t *testing.T) {
	if got := TXT(segs, "es"); got != "Hola.\nBye.\n" {
		t.Fatalf("got %q", got)
	}
}
```

- [ ] **Step 2: Run to see them fail**

Run: `go test ./internal/store/ ./internal/export/`
Expected: FAIL (undefined: New / VTT).

- [ ] **Step 3: Write `internal/store/store.go`**

```go
// Package store persists finalized segments as one append-only JSONL file
// per room, so transcripts survive restarts and can be exported.
package store

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sync"

	"github.com/RchrdHndrcks/lenguaraz/internal/caption"
)

// Store writes segments under dir/{room}.jsonl.
type Store struct {
	dir string
	mu  sync.Mutex
}

// New creates dir if needed.
func New(dir string) (*Store, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, fmt.Errorf("create data dir: %w", err)
	}
	return &Store{dir: dir}, nil
}

func (s *Store) path(room string) string {
	return filepath.Join(s.dir, room+".jsonl")
}

// Append adds one segment to its room's file.
func (s *Store) Append(seg caption.Segment) error {
	line, err := json.Marshal(seg)
	if err != nil {
		return fmt.Errorf("encode segment: %w", err)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	f, err := os.OpenFile(s.path(seg.Room), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return fmt.Errorf("open transcript: %w", err)
	}
	if _, err := f.Write(append(line, '\n')); err != nil {
		f.Close()
		return fmt.Errorf("write transcript: %w", err)
	}
	return f.Close()
}

// Load returns every stored segment of room, oldest first. A room with no
// transcript yet returns nil, nil.
func (s *Store) Load(room string) ([]caption.Segment, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	f, err := os.Open(s.path(room))
	if errors.Is(err, fs.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("open transcript: %w", err)
	}
	defer f.Close()
	var segs []caption.Segment
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 64*1024), 1024*1024)
	for sc.Scan() {
		if len(sc.Bytes()) == 0 {
			continue
		}
		var seg caption.Segment
		if err := json.Unmarshal(sc.Bytes(), &seg); err != nil {
			return nil, fmt.Errorf("decode transcript line: %w", err)
		}
		segs = append(segs, seg)
	}
	return segs, sc.Err()
}
```

- [ ] **Step 4: Write `internal/export/export.go`**

```go
// Package export renders stored segments as subtitle files.
package export

import (
	"fmt"
	"math"
	"strings"

	"github.com/RchrdHndrcks/lenguaraz/internal/caption"
)

// VTT renders WebVTT in the given language.
func VTT(segs []caption.Segment, lang string) string {
	var b strings.Builder
	b.WriteString("WEBVTT\n\n")
	cues(&b, segs, lang, ".")
	return b.String()
}

// SRT renders SubRip in the given language.
func SRT(segs []caption.Segment, lang string) string {
	var b strings.Builder
	cues(&b, segs, lang, ",")
	return b.String()
}

// TXT renders one line per segment in the given language.
func TXT(segs []caption.Segment, lang string) string {
	var b strings.Builder
	for _, s := range segs {
		b.WriteString(s.In(lang))
		b.WriteByte('\n')
	}
	return b.String()
}

func cues(b *strings.Builder, segs []caption.Segment, lang, sep string) {
	for i, s := range segs {
		fmt.Fprintf(b, "%d\n%s --> %s\n%s\n\n", i+1, stamp(s.T0, sep), stamp(s.T1, sep), s.In(lang))
	}
}

// stamp formats seconds as HH:MM:SS<sep>mmm.
func stamp(sec float64, sep string) string {
	ms := int64(math.Round(sec * 1000))
	if ms < 0 {
		ms = 0
	}
	return fmt.Sprintf("%02d:%02d:%02d%s%03d", ms/3_600_000, ms/60_000%60, ms/1000%60, sep, ms%1000)
}
```

- [ ] **Step 5: Run tests**

Run: `go test ./internal/store/ ./internal/export/`
Expected: both `ok`.

- [ ] **Step 6: Commit**

```bash
git add internal/store internal/export
git commit -m "Add JSONL transcript store and subtitle export"
```

---

### Task 3: Room hub (fan-out + ring buffer)

**Files:**
- Create: `internal/room/hub.go`
- Test: `internal/room/hub_test.go`

**Interfaces:**
- Consumes: `caption.Segment`.
- Produces: `room.Msg{Event string; Data any}`; `room.NewHub(size int, seed []caption.Segment) *Hub`; `(*Hub).Subscribe(buf int) (<-chan Msg, []caption.Segment, func())`; `(*Hub).Publish(Msg)`; `(*Hub).Viewers() int`; `(*Hub).Recent() []caption.Segment`. Only `Msg{Event: "final", Data: caption.Segment}` enters the ring.

- [ ] **Step 1: Write the failing test `internal/room/hub_test.go`**

```go
package room

import (
	"fmt"
	"slices"
	"testing"

	"github.com/RchrdHndrcks/lenguaraz/internal/caption"
)

func seg(id int) caption.Segment {
	return caption.Segment{ID: id, Text: fmt.Sprint("line ", id)}
}

func TestHubDeliversToAllSubscribers(t *testing.T) {
	h := NewHub(10, nil)
	a, _, cancelA := h.Subscribe(4)
	defer cancelA()
	b, _, cancelB := h.Subscribe(4)
	defer cancelB()
	h.Publish(Msg{Event: "final", Data: seg(1)})
	for _, ch := range []<-chan Msg{a, b} {
		m := <-ch
		if m.Event != "final" || m.Data.(caption.Segment).ID != 1 {
			t.Fatalf("got %+v", m)
		}
	}
	if h.Viewers() != 2 {
		t.Fatalf("viewers = %d", h.Viewers())
	}
}

func TestHubRingKeepsLastFinals(t *testing.T) {
	h := NewHub(3, []caption.Segment{seg(0)})
	for i := 1; i <= 4; i++ {
		h.Publish(Msg{Event: "final", Data: seg(i)})
	}
	h.Publish(Msg{Event: "interim", Data: map[string]string{"text": "x"}})
	_, snap, cancel := h.Subscribe(1)
	defer cancel()
	var ids []int
	for _, s := range snap {
		ids = append(ids, s.ID)
	}
	if !slices.Equal(ids, []int{2, 3, 4}) {
		t.Fatalf("snapshot ids = %v", ids)
	}
}

func TestHubDropsSlowSubscriber(t *testing.T) {
	h := NewHub(10, nil)
	slow, _, cancel := h.Subscribe(1)
	defer cancel()
	h.Publish(Msg{Event: "interim"})
	h.Publish(Msg{Event: "interim"}) // overflows the buffer of 1
	<-slow                           // the buffered message is still readable
	if _, ok := <-slow; ok {
		t.Fatal("expected the slow subscriber's channel to be closed")
	}
	if h.Viewers() != 0 {
		t.Fatalf("viewers = %d, want 0", h.Viewers())
	}
}

func TestHubCancelIsIdempotent(t *testing.T) {
	h := NewHub(1, nil)
	_, _, cancel := h.Subscribe(1)
	cancel()
	cancel()
	if h.Viewers() != 0 {
		t.Fatalf("viewers = %d", h.Viewers())
	}
}
```

- [ ] **Step 2: Run to see it fail**

Run: `go test ./internal/room/`
Expected: FAIL (undefined: NewHub).

- [ ] **Step 3: Write `internal/room/hub.go`**

```go
package room

import (
	"slices"
	"sync"

	"github.com/RchrdHndrcks/lenguaraz/internal/caption"
)

// Msg is one event sent to viewers: "interim", "final" or "status".
type Msg struct {
	Event string
	Data  any
}

// Hub fans room events out to viewers and remembers the last finals so
// late joiners can catch up. Publish never blocks: a subscriber whose
// buffer is full is dropped (its channel is closed) and its browser
// reconnects on its own.
type Hub struct {
	mu   sync.Mutex
	subs map[chan Msg]struct{}
	ring []caption.Segment
	size int
}

// NewHub keeps the last size finals, starting from seed.
func NewHub(size int, seed []caption.Segment) *Hub {
	h := &Hub{subs: map[chan Msg]struct{}{}, size: size}
	for _, s := range seed {
		h.remember(s)
	}
	return h
}

func (h *Hub) remember(s caption.Segment) {
	h.ring = append(h.ring, s)
	if len(h.ring) > h.size {
		h.ring = slices.Clone(h.ring[len(h.ring)-h.size:])
	}
}

// Subscribe returns live messages, a snapshot of recent finals to replay
// first, and a cancel func (safe to call more than once).
func (h *Hub) Subscribe(buf int) (<-chan Msg, []caption.Segment, func()) {
	ch := make(chan Msg, buf)
	h.mu.Lock()
	h.subs[ch] = struct{}{}
	snap := slices.Clone(h.ring)
	h.mu.Unlock()
	cancel := func() {
		h.mu.Lock()
		defer h.mu.Unlock()
		if _, ok := h.subs[ch]; ok {
			delete(h.subs, ch)
			close(ch)
		}
	}
	return ch, snap, cancel
}

// Publish delivers m to every subscriber.
func (h *Hub) Publish(m Msg) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if s, ok := m.Data.(caption.Segment); ok && m.Event == "final" {
		h.remember(s)
	}
	for ch := range h.subs {
		select {
		case ch <- m:
		default:
			delete(h.subs, ch)
			close(ch)
		}
	}
}

// Viewers is the number of connected subscribers.
func (h *Hub) Viewers() int {
	h.mu.Lock()
	defer h.mu.Unlock()
	return len(h.subs)
}

// Recent returns the remembered finals, oldest first.
func (h *Hub) Recent() []caption.Segment {
	h.mu.Lock()
	defer h.mu.Unlock()
	return slices.Clone(h.ring)
}
```

- [ ] **Step 4: Run tests (with race detector)**

Run: `go test -race ./internal/room/`
Expected: `ok`.

- [ ] **Step 5: Commit**

```bash
git add internal/room
git commit -m "Add room hub with non-blocking fan-out"
```

---

### Task 4: ASR interface, fake engine and transcript assembler

**Files:**
- Create: `internal/asr/asr.go`, `internal/asr/fake.go`, `internal/asr/assemble.go`
- Test: `internal/asr/fake_test.go`, `internal/asr/assemble_test.go`

**Interfaces:**
- Produces:
  ```go
  const BytesPerSecond = 32000
  type Kind int // Interim, Final, Error
  type Event struct { Kind Kind; Text string; At float64 } // At: seconds of audio consumed by the engine this session
  type Config struct { Lang string; Vocabulary []string }
  type Engine interface { Run(ctx context.Context, cfg Config, audio <-chan []byte, events chan<- Event) error }
  type Fake struct { Lines map[string][]string; Every float64 }
  var DefaultLines map[string][]string // DefaultLines["en"][0] == "Welcome to Nerdearla."
  ```
  Engines never close `events`; the caller does after `Run` returns. `Run` returns when `audio` is closed or `ctx` is done.
- Produces (package-internal, used by Task 5): `type assembler struct`, `(*assembler).interim(text string) (Event, bool)`, `(*assembler).final(text string, done bool) (Event, bool)`, `(*assembler).flush() (Event, bool)`, `send(ctx, events, Event)`.

- [ ] **Step 1: Write failing tests**

`internal/asr/fake_test.go`:

```go
package asr

import (
	"context"
	"testing"
)

func TestFakeEmitsInterimThenFinal(t *testing.T) {
	audio := make(chan []byte)
	events := make(chan Event, 16)
	go func() {
		for range 10 { // 1 s in 100 ms chunks
			audio <- make([]byte, BytesPerSecond/10)
		}
		close(audio)
	}()
	if err := (Fake{Every: 1}).Run(context.Background(), Config{Lang: "en"}, audio, events); err != nil {
		t.Fatal(err)
	}
	close(events)
	var got []Event
	for e := range events {
		got = append(got, e)
	}
	want := []Event{
		{Kind: Interim, Text: "Welcome to", At: 0.5},
		{Kind: Final, Text: "Welcome to Nerdearla.", At: 1},
	}
	if len(got) != len(want) || got[0] != want[0] || got[1] != want[1] {
		t.Fatalf("got %+v, want %+v", got, want)
	}
}

func TestFakeUsesRoomLanguage(t *testing.T) {
	audio := make(chan []byte, 1)
	events := make(chan Event, 4)
	audio <- make([]byte, BytesPerSecond)
	close(audio)
	_ = Fake{Every: 1}.Run(context.Background(), Config{Lang: "es"}, audio, events)
	close(events)
	var last Event
	for e := range events {
		last = e
	}
	if last.Text != DefaultLines["es"][0] {
		t.Fatalf("got %q", last.Text)
	}
}
```

`internal/asr/assemble_test.go`:

```go
package asr

import "testing"

func TestAssemblerWaitsForSentenceEnd(t *testing.T) {
	var a assembler
	if _, ok := a.final("Hello", false); ok {
		t.Fatal("should not flush without punctuation")
	}
	ev, ok := a.final("world.", false)
	if !ok || ev.Kind != Final || ev.Text != "Hello world." {
		t.Fatalf("got %+v, %v", ev, ok)
	}
	if _, ok := a.flush(); ok {
		t.Fatal("buffer should be empty after a flush")
	}
}

func TestAssemblerFlushesOnDone(t *testing.T) {
	var a assembler
	ev, ok := a.final("no punctuation here", true)
	if !ok || ev.Text != "no punctuation here" {
		t.Fatalf("got %+v, %v", ev, ok)
	}
}

func TestAssemblerFlushesLongRuns(t *testing.T) {
	var a assembler
	long := ""
	for range 60 {
		long += "word "
	}
	if _, ok := a.final(long, false); !ok {
		t.Fatal("long runs without punctuation must flush")
	}
}

func TestAssemblerJoinsChunks(t *testing.T) {
	cases := []struct{ a, b, want string }{
		{"Hello", "world", "Hello world"},
		{"Hello ", "world", "Hello world"},
		{"Hello", " world", "Hello world"},
		{"Hello", ", world", "Hello, world"},
	}
	for _, c := range cases {
		if got := join(c.a, c.b); got != c.want {
			t.Errorf("join(%q, %q) = %q, want %q", c.a, c.b, got, c.want)
		}
	}
}

func TestAssemblerInterimIncludesPending(t *testing.T) {
	var a assembler
	a.final("We are", false)
	ev, ok := a.interim("live now")
	if !ok || ev.Kind != Interim || ev.Text != "We are live now" {
		t.Fatalf("got %+v, %v", ev, ok)
	}
	if ev, ok := a.interim("  "); !ok || ev.Text != "We are" {
		t.Fatalf("pending text alone is still a valid interim, got %+v, %v", ev, ok)
	}
}
```

- [ ] **Step 2: Run to see failures**

Run: `go test ./internal/asr/`
Expected: FAIL (undefined: Fake, assembler…).

- [ ] **Step 3: Write `internal/asr/asr.go`**

```go
// Package asr turns live PCM audio into transcript events.
package asr

import "context"

// BytesPerSecond of the wire format: PCM16 mono at 16 kHz.
const BytesPerSecond = 16000 * 2

// Kind of transcript event.
type Kind int

const (
	// Interim is a provisional hypothesis for speech still in progress.
	Interim Kind = iota
	// Final is a closed segment that will not change.
	Final
	// Error reports a recoverable failure (the engine keeps running).
	Error
)

// Event is one transcript update. At is the audio position, in seconds of
// audio consumed by the engine during this Run, when the event was produced.
type Event struct {
	Kind Kind
	Text string
	At   float64
}

// Config describes a room's audio to the engine.
type Config struct {
	Lang       string   // "en", "es" or "pt"
	Vocabulary []string // terms to bias recognition towards
}

// Engine transcribes a stream of PCM chunks. Run blocks until audio is
// closed or ctx is done, handles reconnects internally (reporting them as
// Error events) and returns only unrecoverable errors. It never closes
// events.
type Engine interface {
	Run(ctx context.Context, cfg Config, audio <-chan []byte, events chan<- Event) error
}

func send(ctx context.Context, events chan<- Event, e Event) {
	select {
	case events <- e:
	case <-ctx.Done():
	}
}
```

- [ ] **Step 4: Write `internal/asr/fake.go`**

```go
package asr

import "context"

// DefaultLines are the scripted captions Fake emits per language.
var DefaultLines = map[string][]string{
	"en": {"Welcome to Nerdearla.", "Today we will talk about open source.", "These captions are generated live."},
	"es": {"Bienvenidos a Nerdearla.", "Hoy vamos a hablar de código abierto.", "Estos subtítulos se generan en vivo."},
	"pt": {"Bem-vindos à Nerdearla.", "Hoje vamos falar de código aberto.", "Estas legendas são geradas ao vivo."},
}

// Fake is a scripted Engine for tests and offline demos: for every Every
// seconds of audio (default 3) it emits an interim with the first half of
// the next line, then the full line as a final.
type Fake struct {
	Lines map[string][]string
	Every float64
}

func (f Fake) Run(ctx context.Context, cfg Config, audio <-chan []byte, events chan<- Event) error {
	lines := f.Lines[cfg.Lang]
	if len(lines) == 0 {
		lines = DefaultLines[cfg.Lang]
	}
	if len(lines) == 0 {
		lines = DefaultLines["en"]
	}
	every := f.Every
	if every <= 0 {
		every = 3
	}
	per := int64(every * BytesPerSecond)
	var total, mark int64
	n, half := 0, false
	for {
		select {
		case <-ctx.Done():
			return nil
		case chunk, ok := <-audio:
			if !ok {
				return nil
			}
			total += int64(len(chunk))
			at := float64(total) / BytesPerSecond
			line := []rune(lines[n%len(lines)])
			if !half && total-mark >= per/2 {
				half = true
				send(ctx, events, Event{Kind: Interim, Text: string(line[:len(line)/2]), At: at})
			}
			if total-mark >= per {
				mark += per
				half = false
				n++
				send(ctx, events, Event{Kind: Final, Text: string(line), At: at})
			}
		}
	}
}
```

Note: "Welcome to Nerdearla." is 21 runes; the first 10 runes are "Welcome to" — matching the test.

- [ ] **Step 5: Write `internal/asr/assemble.go`**

```go
package asr

import (
	"strings"
	"unicode"
	"unicode/utf8"
)

// maxSegment forces a final when a speaker runs on without punctuation, so
// translations never wait on an endless sentence.
const maxSegment = 240

// assembler folds the Live API's transcription chunks into caption events:
// finalized chunks accumulate until they end a sentence (or the server says
// the turn is done), interim text is shown after what is already pending.
type assembler struct {
	pending string
}

func (a *assembler) interim(text string) (Event, bool) {
	t := strings.TrimSpace(join(a.pending, text))
	return Event{Kind: Interim, Text: t}, t != ""
}

func (a *assembler) final(text string, done bool) (Event, bool) {
	a.pending = join(a.pending, text)
	s := strings.TrimSpace(a.pending)
	if s == "" {
		a.pending = ""
		return Event{}, false
	}
	if !done && !endsSentence(s) && len(s) < maxSegment {
		return Event{}, false
	}
	a.pending = ""
	return Event{Kind: Final, Text: s}, true
}

func (a *assembler) flush() (Event, bool) {
	return a.final("", true)
}

func endsSentence(s string) bool {
	r, _ := utf8.DecodeLastRuneInString(s)
	return strings.ContainsRune(".?!…", r)
}

// join concatenates transcript chunks, adding a space only when neither
// side already has one and the second chunk doesn't start with punctuation.
func join(a, b string) string {
	if a == "" || b == "" {
		return a + b
	}
	last, _ := utf8.DecodeLastRuneInString(a)
	first, _ := utf8.DecodeRuneInString(b)
	if unicode.IsSpace(last) || unicode.IsSpace(first) || unicode.IsPunct(first) {
		return a + b
	}
	return a + " " + b
}
```

- [ ] **Step 6: Run tests**

Run: `go test -race ./internal/asr/`
Expected: `ok`.

- [ ] **Step 7: Commit**

```bash
git add internal/asr
git commit -m "Add ASR engine interface, fake engine and assembler"
```

---

### Task 5: Gemini Live ASR engine, samples and protocol smoke test

**Files:**
- Create: `internal/asr/gemini.go`, `cmd/asr-smoke/main.go`, `samples/make-samples.sh`, `samples/en.wav`, `samples/es.wav`

**Interfaces:**
- Consumes: `asr.Engine`, `Event`, `assembler`, `send` from Task 4.
- Produces: `asr.Gemini{Client *genai.Client; Model string; MaxSession time.Duration; Log *slog.Logger; Debug bool}` implementing `Engine`; `asr.DefaultModel = "gemini-3.5-transcribe-live"`.

- [ ] **Step 1: Add the SDK**

Run: `go get google.golang.org/genai@v1.71.0`

- [ ] **Step 2: Write `internal/asr/gemini.go`**

```go
package asr

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"sync/atomic"
	"time"

	"google.golang.org/genai"
)

// DefaultModel is Gemini's dedicated live transcription model.
const DefaultModel = "gemini-3.5-transcribe-live"

// Live transcription sessions are capped at 10 minutes; rotate before that.
const defaultMaxSession = 9 * time.Minute

// After the operator stops, wait this long for trailing transcripts.
const drainTimeout = 3 * time.Second

var errGoAway = errors.New("server requested reconnect")

var languageCodes = map[string][]string{
	"en": {"en-US"},
	"es": {"es-ES"},
	"pt": {"pt-BR"},
}

// Gemini transcribes with the Gemini Live API. Each Run holds one session
// at a time and replaces it when it expires or fails. Transcription has no
// conversational state, so sessions are simply reopened, not resumed.
type Gemini struct {
	Client     *genai.Client
	Model      string
	MaxSession time.Duration
	Log        *slog.Logger
	Debug      bool // log every raw server message
}

func (g *Gemini) model() string {
	if g.Model != "" {
		return g.Model
	}
	return DefaultModel
}

func (g *Gemini) log() *slog.Logger {
	if g.Log != nil {
		return g.Log
	}
	return slog.Default()
}

func (g *Gemini) maxSession() time.Duration {
	if g.MaxSession > 0 {
		return g.MaxSession
	}
	return defaultMaxSession
}

func (g *Gemini) Run(ctx context.Context, cfg Config, audio <-chan []byte, events chan<- Event) error {
	var sent atomic.Int64 // bytes of audio sent this Run: the event clock
	var asm assembler     // survives session rotation so no text is lost
	backoff := time.Second
	for ctx.Err() == nil {
		sctx, cancel := context.WithTimeout(ctx, g.maxSession())
		ended, err := g.session(sctx, cfg, &asm, audio, events, &sent)
		cancel()
		if ended || ctx.Err() != nil {
			return nil
		}
		if err == nil || errors.Is(err, errGoAway) {
			backoff = time.Second
			continue
		}
		g.log().Warn("live session failed, reconnecting", "err", err, "in", backoff)
		send(ctx, events, Event{Kind: Error, Text: err.Error(), At: float64(sent.Load()) / BytesPerSecond})
		select {
		case <-time.After(backoff):
		case <-ctx.Done():
			return nil
		}
		backoff = min(backoff*2, 10*time.Second)
	}
	return nil
}

// session runs one Live connection. ended reports that audio was closed.
func (g *Gemini) session(ctx context.Context, cfg Config, asm *assembler, audio <-chan []byte, events chan<- Event, sent *atomic.Int64) (ended bool, err error) {
	sess, err := g.Client.Live.Connect(ctx, g.model(), &genai.LiveConnectConfig{
		ResponseModalities: []genai.Modality{genai.ModalityText},
		InputAudioTranscription: &genai.AudioTranscriptionConfig{
			LanguageCodes:    languageCodes[cfg.Lang],
			CustomVocabulary: cfg.Vocabulary,
		},
	})
	if err != nil {
		return false, fmt.Errorf("connect: %w", err)
	}
	recvErr := make(chan error, 1)
	go func() { recvErr <- g.receive(ctx, sess, asm, events, sent) }()
	closeAndWait := func() {
		sess.Close()
		<-recvErr
	}
	for {
		select {
		case <-ctx.Done():
			closeAndWait()
			return false, nil
		case err := <-recvErr:
			sess.Close()
			return false, err
		case chunk, ok := <-audio:
			if !ok {
				_ = sess.SendRealtimeInput(genai.LiveRealtimeInput{AudioStreamEnd: true})
				select {
				case <-recvErr:
					sess.Close()
				case <-time.After(drainTimeout):
					closeAndWait()
				}
				if ev, ok := asm.flush(); ok {
					ev.At = float64(sent.Load()) / BytesPerSecond
					send(ctx, events, ev)
				}
				return true, nil
			}
			if err := sess.SendRealtimeInput(genai.LiveRealtimeInput{
				Audio: &genai.Blob{Data: chunk, MIMEType: "audio/pcm;rate=16000"},
			}); err != nil {
				closeAndWait()
				return false, fmt.Errorf("send audio: %w", err)
			}
			sent.Add(int64(len(chunk)))
		}
	}
}

func (g *Gemini) receive(ctx context.Context, sess *genai.Session, asm *assembler, events chan<- Event, sent *atomic.Int64) error {
	for {
		msg, err := sess.Receive()
		if err != nil {
			return fmt.Errorf("receive: %w", err)
		}
		if g.Debug {
			if b, err := json.Marshal(msg); err == nil {
				g.log().Info("live message", "msg", string(b))
			}
		}
		if msg.GoAway != nil {
			return errGoAway
		}
		sc := msg.ServerContent
		if sc == nil {
			continue
		}
		at := float64(sent.Load()) / BytesPerSecond
		if t := sc.InterimInputTranscription; t != nil {
			if ev, ok := asm.interim(t.Text); ok {
				ev.At = at
				send(ctx, events, ev)
			}
		}
		var ev Event
		var ok bool
		if t := sc.InputTranscription; t != nil {
			ev, ok = asm.final(t.Text, t.Finished || sc.TurnComplete)
		} else if sc.TurnComplete {
			ev, ok = asm.flush()
		}
		if ok {
			ev.At = at
			send(ctx, events, ev)
		}
	}
}
```

- [ ] **Step 3: Build and vet**

Run: `go build ./... && go vet ./internal/asr/`
Expected: no output. If a genai field name differs, check it with `grep -n "<Name>" $(go list -m -f '{{.Dir}}' google.golang.org/genai)/types.go` and fix.

- [ ] **Step 4: Write `cmd/asr-smoke/main.go`**

```go
// Command asr-smoke streams raw PCM16 16 kHz mono from stdin to the Gemini
// Live transcription engine in real time and prints the events. Use it to
// check the protocol and tune the assembler:
//
//	ffmpeg -loglevel error -i samples/en.wav -f s16le -ac 1 -ar 16000 - |
//	  go run ./cmd/asr-smoke -lang en -debug
package main

import (
	"bufio"
	"context"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/signal"
	"sync"
	"time"

	"google.golang.org/genai"

	"github.com/RchrdHndrcks/lenguaraz/internal/asr"
)

func main() {
	lang := flag.String("lang", "en", "spoken language: en, es or pt")
	model := flag.String("model", "", "Live model (default "+asr.DefaultModel+")")
	debug := flag.Bool("debug", false, "log raw server messages")
	flag.Parse()

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	client, err := genai.NewClient(ctx, &genai.ClientConfig{APIKey: os.Getenv("GEMINI_API_KEY"), Backend: genai.BackendGeminiAPI})
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}

	audio := make(chan []byte, 50)
	go func() {
		defer close(audio)
		in := bufio.NewReader(os.Stdin)
		tick := time.NewTicker(100 * time.Millisecond)
		defer tick.Stop()
		for range tick.C {
			buf := make([]byte, asr.BytesPerSecond/10)
			n, err := io.ReadFull(in, buf)
			if n > 0 {
				audio <- buf[:n]
			}
			if err != nil {
				return
			}
		}
	}()

	events := make(chan asr.Event, 64)
	var wg sync.WaitGroup
	wg.Go(func() {
		names := map[asr.Kind]string{asr.Interim: "interim", asr.Final: "FINAL", asr.Error: "error"}
		for ev := range events {
			fmt.Printf("%7.1fs %-7s %s\n", ev.At, names[ev.Kind], ev.Text)
		}
	})
	eng := &asr.Gemini{Client: client, Model: *model, Debug: *debug, Log: slog.Default()}
	err = eng.Run(ctx, asr.Config{Lang: *lang, Vocabulary: []string{"Nerdearla"}}, audio, events)
	close(events)
	wg.Wait()
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
```

- [ ] **Step 5: Write `samples/make-samples.sh` and generate the clips**

```bash
#!/usr/bin/env bash
# Regenerates the sample clips with macOS text-to-speech so they can be
# redistributed with the repo. Requires `say` (macOS) and ffmpeg.
set -euo pipefail
cd "$(dirname "$0")"

en="Welcome to Nerdearla. Today we are going to talk about how open source \
communities make conferences more accessible. Real time captions help people \
who are deaf or hard of hearing, people who are learning English, and anyone \
sitting in the back of a noisy room. With Gemini, we can transcribe a talk as \
it happens and translate it into Spanish in less than a second. Kubernetes, \
eBPF and WebAssembly are the kind of words a good glossary should protect."

es="Bienvenidos a Nerdearla. Hoy vamos a hablar de cómo las comunidades de \
código abierto hacen que las conferencias sean más accesibles. Los subtítulos \
en tiempo real ayudan a personas sordas o con hipoacusia, a quienes están \
aprendiendo español y a cualquiera que esté sentado al fondo de una sala \
ruidosa. Con Gemini podemos transcribir una charla mientras sucede y \
traducirla al inglés en menos de un segundo."

say -v Samantha -o en.aiff "$en"
say -v Paulina -o es.aiff "$es"
for f in en es; do
  ffmpeg -loglevel error -y -i "$f.aiff" -ac 1 -ar 16000 -sample_fmt s16 "$f.wav"
  rm "$f.aiff"
done
ls -lh ./*.wav
```

Run: `chmod +x samples/make-samples.sh && samples/make-samples.sh`
Expected: `en.wav` and `es.wav`, each roughly 0.8–1.2 MB (~30 s).

- [ ] **Step 6: Protocol smoke test against the real API**

Requires `GEMINI_API_KEY` exported (ask the user for it if it isn't set; never commit it).

Run:
```bash
ffmpeg -loglevel error -i samples/en.wav -f s16le -ac 1 -ar 16000 - | go run ./cmd/asr-smoke -lang en -debug 2>smoke.log
```
Expected: `interim` lines updating within ~1 s of speech and several `FINAL` lines, each a full sentence ending in punctuation, spelled "Nerdearla". Then run the same with `samples/es.wav -lang es`.

If the output deviates, read `smoke.log` (raw messages) and fix before moving on:
- No transcripts at all / setup error → check the model id and `ResponseModalities` in the error message.
- Interim text *replaces* rather than *extends* the pending text in unexpected ways, or finals arrive word-by-word with no punctuation → adjust `assembler` (and its tests) to the observed shape.
- `languageCodes` rejected → switch to the code the error suggests (e.g. plain `es`).

Delete `smoke.log` afterwards (`rm smoke.log`); it is not committed.

- [ ] **Step 7: Commit**

```bash
git add internal/asr cmd/asr-smoke samples go.mod go.sum
git commit -m "Add Gemini Live transcription engine and samples"
```

---

### Task 6: Translator

**Files:**
- Create: `internal/translate/translate.go`, `internal/translate/gemini.go`
- Test: `internal/translate/translate_test.go`

**Interfaces:**
- Produces: `translate.Translator` interface `Translate(ctx context.Context, text, src, dst string, glossary []string) (string, error)`; `translate.Prompt(src, dst string, glossary []string) string`; `translate.Fake{}` returning `"[" + dst + "] " + text`; `translate.Gemini{Client *genai.Client; Model string}`; `translate.DefaultModel = "gemini-3.5-flash-lite"`.

- [ ] **Step 1: Write the failing test `internal/translate/translate_test.go`**

```go
package translate

import (
	"context"
	"strings"
	"testing"
)

func TestPromptNamesLanguagesAndGlossary(t *testing.T) {
	p := Prompt("en", "es", []string{"Kubernetes", "Nerdearla"})
	for _, want := range []string{"from English to Spanish", "Kubernetes, Nerdearla", "Output only the translation"} {
		if !strings.Contains(p, want) {
			t.Errorf("prompt missing %q:\n%s", want, p)
		}
	}
	if strings.Contains(Prompt("es", "en", nil), "Never translate these terms") {
		t.Error("empty glossary should not add the glossary clause")
	}
}

func TestFake(t *testing.T) {
	got, err := Fake{}.Translate(context.Background(), "Hello.", "en", "es", nil)
	if err != nil || got != "[es] Hello." {
		t.Fatalf("got %q, %v", got, err)
	}
}
```

- [ ] **Step 2: Run to see it fail**

Run: `go test ./internal/translate/`
Expected: FAIL (undefined: Prompt).

- [ ] **Step 3: Write `internal/translate/translate.go`**

```go
// Package translate turns finalized caption lines into other languages.
package translate

import (
	"context"
	"fmt"
	"strings"
)

// Translator translates one caption line from src to dst, leaving glossary
// terms untouched.
type Translator interface {
	Translate(ctx context.Context, text, src, dst string, glossary []string) (string, error)
}

var names = map[string]string{"en": "English", "es": "Spanish", "pt": "Portuguese"}

func name(code string) string {
	if n, ok := names[code]; ok {
		return n
	}
	return code
}

// Prompt is the system instruction for one language pair.
func Prompt(src, dst string, glossary []string) string {
	var b strings.Builder
	fmt.Fprintf(&b, "You translate live conference captions from %s to %s.\n", name(src), name(dst))
	b.WriteString("Output only the translation of the given line: no quotes, notes or explanations. ")
	b.WriteString("Keep product names, code, commands and acronyms that are normally left untranslated. ")
	b.WriteString("The line may be an incomplete sentence; translate it as is, without completing or answering it.")
	if len(glossary) > 0 {
		fmt.Fprintf(&b, "\nNever translate these terms and keep their spelling: %s.", strings.Join(glossary, ", "))
	}
	return b.String()
}

// Fake tags the text with the target language; for tests and offline demos.
type Fake struct{}

func (Fake) Translate(_ context.Context, text, _, dst string, _ []string) (string, error) {
	return "[" + dst + "] " + text, nil
}
```

- [ ] **Step 4: Write `internal/translate/gemini.go`**

```go
package translate

import (
	"context"
	"fmt"
	"strings"

	"google.golang.org/genai"
)

// DefaultModel is a fast, cheap text model: captions are short and latency
// matters more than depth.
const DefaultModel = "gemini-3.5-flash-lite"

// Gemini translates with a Gemini text model.
type Gemini struct {
	Client *genai.Client
	Model  string
}

func (g Gemini) Translate(ctx context.Context, text, src, dst string, glossary []string) (string, error) {
	model := g.Model
	if model == "" {
		model = DefaultModel
	}
	temp := float32(0)
	resp, err := g.Client.Models.GenerateContent(ctx, model, genai.Text(text), &genai.GenerateContentConfig{
		SystemInstruction: genai.NewContentFromText(Prompt(src, dst, glossary), genai.RoleUser),
		Temperature:       &temp,
	})
	if err != nil {
		return "", fmt.Errorf("translate %s→%s: %w", src, dst, err)
	}
	out := strings.TrimSpace(resp.Text())
	if out == "" {
		return "", fmt.Errorf("translate %s→%s: empty response", src, dst)
	}
	return out, nil
}
```

- [ ] **Step 5: Run tests and a live check**

Run: `go test ./internal/translate/`
Expected: `ok`.

Live check (needs `GEMINI_API_KEY`) with a throwaway test file that is deleted right after:

```bash
cat > internal/translate/zz_live_test.go <<'GO'
package translate_test

import (
	"context"
	"os"
	"testing"

	"google.golang.org/genai"

	"github.com/RchrdHndrcks/lenguaraz/internal/translate"
)

func TestLive(t *testing.T) {
	c, err := genai.NewClient(context.Background(), &genai.ClientConfig{APIKey: os.Getenv("GEMINI_API_KEY"), Backend: genai.BackendGeminiAPI})
	if err != nil {
		t.Fatal(err)
	}
	out, err := translate.Gemini{Client: c}.Translate(context.Background(),
		"Welcome to Nerdearla, today we deploy Kubernetes with eBPF.", "en", "es",
		[]string{"Nerdearla", "Kubernetes", "eBPF"})
	t.Log(out, err)
}
GO
go test -run TestLive -v ./internal/translate/; rm internal/translate/zz_live_test.go
```
Expected: a natural Spanish sentence keeping "Nerdearla", "Kubernetes", "eBPF". If the model id is rejected, pick the current flash-lite id from https://ai.google.dev/gemini-api/docs/models and update `DefaultModel`.

- [ ] **Step 6: Commit**

```bash
git add internal/translate go.mod go.sum
git commit -m "Add caption translator with glossary prompt"
```

---

### Task 7: Room pipeline

**Files:**
- Create: `internal/room/room.go`
- Test: `internal/room/room_test.go`

**Interfaces:**
- Consumes: `Hub`, `Msg` (Task 3); `asr.Engine`, `asr.Event`, `asr.Config` (Task 4); `translate.Translator` (Task 6); `store.Store` (Task 2); `config.Room` (Task 1).
- Produces:
  ```go
  type Deps struct { ASR asr.Engine; Translator translate.Translator; Store *store.Store; Log *slog.Logger }
  func New(cfg config.Room, deps Deps) (*Room, error)
  func (r *Room) Config() config.Room
  func (r *Room) Hub() *Hub
  func (r *Room) Run(ctx context.Context, audio <-chan []byte) error // ErrBusy if an operator is already live
  func (r *Room) Status() Status
  var ErrBusy error
  type Status struct { ID, Title, Source string; Targets []string; Live bool; Viewers, Segments int; LastSegmentAt time.Time; AvgLatencyMs int64; Errors int; LastError string }
  ```
  JSON tags on Status: `id,title,source,targets,live,viewers,segments,lastSegmentAt,avgLatencyMs,errors,lastError`.

- [ ] **Step 1: Write the failing test `internal/room/room_test.go`**

```go
package room

import (
	"context"
	"errors"
	"log/slog"
	"testing"
	"time"

	"github.com/RchrdHndrcks/lenguaraz/internal/asr"
	"github.com/RchrdHndrcks/lenguaraz/internal/caption"
	"github.com/RchrdHndrcks/lenguaraz/internal/config"
	"github.com/RchrdHndrcks/lenguaraz/internal/store"
	"github.com/RchrdHndrcks/lenguaraz/internal/translate"
)

type failTranslator struct{}

func (failTranslator) Translate(context.Context, string, string, string, []string) (string, error) {
	return "", errors.New("boom")
}

func newRoom(t *testing.T, st *store.Store, tr translate.Translator) *Room {
	t.Helper()
	rm, err := New(
		config.Room{ID: "sala-a", Title: "A", Source: "en", Targets: []string{"es"}},
		Deps{ASR: asr.Fake{Every: 1}, Translator: tr, Store: st, Log: slog.New(slog.DiscardHandler)},
	)
	if err != nil {
		t.Fatal(err)
	}
	return rm
}

func newStore(t *testing.T) *store.Store {
	t.Helper()
	st, err := store.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	return st
}

// feed sends secs seconds of silence in 100 ms chunks, then closes audio.
func feed(audio chan<- []byte, secs int) {
	for range secs * 10 {
		audio <- make([]byte, asr.BytesPerSecond/10)
	}
	close(audio)
}

func finals(sub <-chan Msg) []caption.Segment {
	var out []caption.Segment
	for len(sub) > 0 {
		if m := <-sub; m.Event == "final" {
			out = append(out, m.Data.(caption.Segment))
		}
	}
	return out
}

func waitFor(t *testing.T, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for !cond() {
		if time.Now().After(deadline) {
			t.Fatal("condition not met in time")
		}
		time.Sleep(5 * time.Millisecond)
	}
}

func TestRoomPublishesTranslatedFinals(t *testing.T) {
	st := newStore(t)
	rm := newRoom(t, st, translate.Fake{})
	sub, _, cancel := rm.Hub().Subscribe(64)
	defer cancel()

	audio := make(chan []byte)
	go feed(audio, 2)
	if err := rm.Run(context.Background(), audio); err != nil {
		t.Fatal(err)
	}

	got := finals(sub)
	if len(got) != 2 {
		t.Fatalf("finals = %d, want 2", len(got))
	}
	first := got[0]
	if first.ID != 0 || first.Room != "sala-a" || first.Lang != "en" || first.T0 != 0 || first.T1 != 1 ||
		first.Text != "Welcome to Nerdearla." || first.Translations["es"] != "[es] Welcome to Nerdearla." {
		t.Fatalf("first = %+v", first)
	}
	if got[1].ID != 1 || got[1].T0 != 1 || got[1].T1 != 2 {
		t.Fatalf("second = %+v", got[1])
	}
	stored, _ := st.Load("sala-a")
	if len(stored) != 2 {
		t.Fatalf("stored = %d, want 2", len(stored))
	}
	s := rm.Status()
	if s.Live || s.Segments != 2 || s.Errors != 0 || s.LastSegmentAt.IsZero() {
		t.Fatalf("status = %+v", s)
	}
}

func TestRoomRejectsSecondOperator(t *testing.T) {
	rm := newRoom(t, newStore(t), translate.Fake{})
	first := make(chan []byte)
	done := make(chan error, 1)
	go func() { done <- rm.Run(context.Background(), first) }()
	waitFor(t, func() bool { return rm.Status().Live })

	if err := rm.Run(context.Background(), make(chan []byte)); !errors.Is(err, ErrBusy) {
		t.Fatalf("err = %v, want ErrBusy", err)
	}
	close(first)
	if err := <-done; err != nil {
		t.Fatal(err)
	}
}

func TestRoomKeepsOriginalWhenTranslationFails(t *testing.T) {
	rm := newRoom(t, newStore(t), failTranslator{})
	sub, _, cancel := rm.Hub().Subscribe(64)
	defer cancel()
	audio := make(chan []byte)
	go feed(audio, 2)
	_ = rm.Run(context.Background(), audio)

	got := finals(sub)
	if len(got) != 2 || got[0].Error == "" || got[0].Translations["es"] != "" || got[0].Text == "" {
		t.Fatalf("finals = %+v", got)
	}
	if s := rm.Status(); s.Errors != 2 || s.LastError == "" {
		t.Fatalf("status = %+v", s)
	}
}

func TestRoomResumesClockAndIDsFromStore(t *testing.T) {
	st := newStore(t)
	rm := newRoom(t, st, translate.Fake{})
	audio := make(chan []byte)
	go feed(audio, 2)
	_ = rm.Run(context.Background(), audio)

	again := newRoom(t, st, translate.Fake{})
	if n := len(again.Hub().Recent()); n != 2 {
		t.Fatalf("recent after reload = %d, want 2", n)
	}
	sub, _, cancel := again.Hub().Subscribe(64)
	defer cancel()
	audio = make(chan []byte)
	go feed(audio, 1)
	_ = again.Run(context.Background(), audio)
	got := finals(sub)
	if len(got) != 1 || got[0].ID != 2 || got[0].T0 != 2 || got[0].T1 != 3 {
		t.Fatalf("after reload = %+v", got)
	}
}
```

- [ ] **Step 2: Run to see it fail**

Run: `go test ./internal/room/`
Expected: FAIL (undefined: New, Deps…).

- [ ] **Step 3: Write `internal/room/room.go`**

```go
// Package room runs the captioning pipeline for one stage: operator audio →
// ASR → translation → store → viewers.
package room

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/RchrdHndrcks/lenguaraz/internal/asr"
	"github.com/RchrdHndrcks/lenguaraz/internal/caption"
	"github.com/RchrdHndrcks/lenguaraz/internal/config"
	"github.com/RchrdHndrcks/lenguaraz/internal/store"
	"github.com/RchrdHndrcks/lenguaraz/internal/translate"
)

// ringSize is how many recent finals a new viewer receives.
const ringSize = 50

// translateTimeout bounds one segment's translations; segments in flight
// finish even if the operator disconnects.
const translateTimeout = 15 * time.Second

// ErrBusy means another operator is already streaming into the room.
var ErrBusy = errors.New("room already has a live operator")

// Deps are the pipeline's collaborators, shared by every room.
type Deps struct {
	ASR        asr.Engine
	Translator translate.Translator
	Store      *store.Store
	Log        *slog.Logger
}

// Status is the room's health, for the production panel.
type Status struct {
	ID            string    `json:"id"`
	Title         string    `json:"title"`
	Source        string    `json:"source"`
	Targets       []string  `json:"targets"`
	Live          bool      `json:"live"`
	Viewers       int       `json:"viewers"`
	Segments      int       `json:"segments"`
	LastSegmentAt time.Time `json:"lastSegmentAt"`
	AvgLatencyMs  int64     `json:"avgLatencyMs"`
	Errors        int       `json:"errors"`
	LastError     string    `json:"lastError,omitempty"`
}

// Room is one stage.
type Room struct {
	cfg  config.Room
	deps Deps
	hub  *Hub

	mu        sync.Mutex
	live      bool
	nextID    int
	lastT1    float64 // end of the last segment on the room's audio clock
	segments  int
	latency   time.Duration // sum over segments
	lastAt    time.Time
	errors    int
	lastError string
}

type finalJob struct {
	text     string
	t0, t1   float64
	received time.Time
}

// New builds a room and restores its recent history from the store.
func New(cfg config.Room, deps Deps) (*Room, error) {
	seed, err := deps.Store.Load(cfg.ID)
	if err != nil {
		return nil, fmt.Errorf("room %s: %w", cfg.ID, err)
	}
	r := &Room{cfg: cfg, deps: deps, hub: NewHub(ringSize, seed)}
	if n := len(seed); n > 0 {
		r.nextID = seed[n-1].ID + 1
		r.lastT1 = seed[n-1].T1
	}
	return r, nil
}

func (r *Room) Config() config.Room { return r.cfg }
func (r *Room) Hub() *Hub           { return r.hub }

// Run processes one operator session until audio is closed or ctx ends.
// Finals are published in order; Run returns after the last one is out.
func (r *Room) Run(ctx context.Context, audio <-chan []byte) error {
	r.mu.Lock()
	if r.live {
		r.mu.Unlock()
		return ErrBusy
	}
	r.live = true
	base := r.lastT1
	r.mu.Unlock()
	r.publishLive(true)
	defer r.publishLive(false)

	finals := make(chan finalJob, 64)
	done := make(chan struct{})
	go func() {
		defer close(done)
		for j := range finals {
			r.publishFinal(ctx, j)
		}
	}()

	events := make(chan asr.Event, 64)
	asrErr := make(chan error, 1)
	go func() {
		asrErr <- r.deps.ASR.Run(ctx, asr.Config{Lang: r.cfg.Source, Vocabulary: r.cfg.Glossary}, audio, events)
		close(events)
	}()

	for ev := range events {
		switch ev.Kind {
		case asr.Interim:
			r.hub.Publish(Msg{Event: "interim", Data: map[string]string{"text": ev.Text}})
		case asr.Final:
			r.mu.Lock()
			t0 := r.lastT1
			t1 := max(base+ev.At, t0)
			r.lastT1 = t1
			r.mu.Unlock()
			finals <- finalJob{text: ev.Text, t0: t0, t1: t1, received: time.Now()}
		case asr.Error:
			r.recordError(ev.Text)
		}
	}
	close(finals)
	<-done
	err := <-asrErr
	if err != nil {
		r.recordError(err.Error())
	}
	return err
}

func (r *Room) publishLive(live bool) {
	r.mu.Lock()
	r.live = live
	r.mu.Unlock()
	r.hub.Publish(Msg{Event: "status", Data: map[string]bool{"live": live}})
}

func (r *Room) publishFinal(ctx context.Context, j finalJob) {
	tctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), translateTimeout)
	defer cancel()
	seg := caption.Segment{Room: r.cfg.ID, T0: j.t0, T1: j.t1, Lang: r.cfg.Source, Text: j.text, Translations: map[string]string{}}
	var (
		mu   sync.Mutex
		wg   sync.WaitGroup
		errs []string
	)
	for _, dst := range r.cfg.Targets {
		wg.Go(func() {
			out, err := r.deps.Translator.Translate(tctx, j.text, r.cfg.Source, dst, r.cfg.Glossary)
			mu.Lock()
			defer mu.Unlock()
			if err != nil {
				errs = append(errs, err.Error())
				return
			}
			seg.Translations[dst] = out
		})
	}
	wg.Wait()
	seg.Error = strings.Join(errs, "; ")

	r.mu.Lock()
	seg.ID = r.nextID
	r.nextID++
	r.segments++
	r.latency += time.Since(j.received)
	r.lastAt = time.Now()
	r.mu.Unlock()
	if seg.Error != "" {
		r.recordError(seg.Error)
	}
	if err := r.deps.Store.Append(seg); err != nil {
		r.recordError(err.Error())
	}
	r.hub.Publish(Msg{Event: "final", Data: seg})
}

func (r *Room) recordError(msg string) {
	r.deps.Log.Warn("room error", "room", r.cfg.ID, "err", msg)
	r.mu.Lock()
	defer r.mu.Unlock()
	r.errors++
	r.lastError = msg
}

// Status snapshots the room for the production panel.
func (r *Room) Status() Status {
	viewers := r.hub.Viewers()
	r.mu.Lock()
	defer r.mu.Unlock()
	var avg int64
	if r.segments > 0 {
		avg = (r.latency / time.Duration(r.segments)).Milliseconds()
	}
	return Status{
		ID: r.cfg.ID, Title: r.cfg.Title, Source: r.cfg.Source, Targets: r.cfg.Targets,
		Live: r.live, Viewers: viewers, Segments: r.segments, LastSegmentAt: r.lastAt,
		AvgLatencyMs: avg, Errors: r.errors, LastError: r.lastError,
	}
}
```

- [ ] **Step 4: Run tests with the race detector**

Run: `go test -race ./internal/room/`
Expected: `ok`.

- [ ] **Step 5: Commit**

```bash
git add internal/room
git commit -m "Add per-room captioning pipeline"
```

---

### Task 8: HTTP server, SSE, audio ingest and main

**Files:**
- Create: `internal/web/server.go`, `internal/web/static/index.html`, `internal/web/static/viewer.html`, `internal/web/static/operator.html`, `internal/web/static/admin.html` (stubs, replaced in Tasks 9–10), `cmd/lenguaraz/main.go`
- Test: `internal/web/server_test.go`

**Interfaces:**
- Consumes: `room.Room` (`Config`, `Hub`, `Run`, `Status`, `ErrBusy`), `store.Store.Load`, `export.VTT/SRT/TXT`.
- Produces: `web.New(rooms []*room.Room, st *store.Store, token string, log *slog.Logger) *Server`, `(*Server).Handler() http.Handler`.
- HTTP surface (used by the frontend in Tasks 9–10):
  - `GET /` index · `GET /r/{room}` viewer · `GET /operator/{room}` operator · `GET /admin` admin · `GET /static/...`
  - `GET /api/rooms` → `[{"id","title","source","targets","live"}]`
  - `GET /api/admin/status` (token) → `[]room.Status`
  - `GET /events/{room}` SSE: first `status`, then replayed `final`s, then live events; `: ping` every 15 s
  - `GET /ingest/{room}?token=…` WebSocket, binary PCM frames; 409 if busy, 401 bad token
  - `GET /export/{room}/{vtt|srt|txt}?lang=xx`
  - `GET /healthz` → `ok`
- Token: `?token=` or `Authorization: Bearer …`; empty configured token = open.

- [ ] **Step 1: Create the static stubs**

Each of `internal/web/static/{index,viewer,operator,admin}.html`:

```html
<!doctype html><html lang="es"><meta charset="utf-8"><title>Lenguaraz</title><p>Lenguaraz</p></html>
```

- [ ] **Step 2: Write the failing test `internal/web/server_test.go`**

```go
package web

import (
	"bufio"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"

	"github.com/RchrdHndrcks/lenguaraz/internal/asr"
	"github.com/RchrdHndrcks/lenguaraz/internal/caption"
	"github.com/RchrdHndrcks/lenguaraz/internal/config"
	"github.com/RchrdHndrcks/lenguaraz/internal/room"
	"github.com/RchrdHndrcks/lenguaraz/internal/store"
	"github.com/RchrdHndrcks/lenguaraz/internal/translate"
)

func newTestServer(t *testing.T) *httptest.Server {
	t.Helper()
	st, err := store.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	log := slog.New(slog.DiscardHandler)
	var rooms []*room.Room
	for _, rc := range []config.Room{
		{ID: "sala-a", Title: "A", Source: "en", Targets: []string{"es"}},
		{ID: "sala-b", Title: "B", Source: "es", Targets: []string{"en"}},
	} {
		rm, err := room.New(rc, room.Deps{ASR: asr.Fake{Every: 1}, Translator: translate.Fake{}, Store: st, Log: log})
		if err != nil {
			t.Fatal(err)
		}
		rooms = append(rooms, rm)
	}
	srv := httptest.NewServer(New(rooms, st, "secret", log).Handler())
	t.Cleanup(srv.Close)
	return srv
}

func get(t *testing.T, url string, header ...string) (*http.Response, string) {
	t.Helper()
	req, _ := http.NewRequest(http.MethodGet, url, nil)
	for i := 0; i+1 < len(header); i += 2 {
		req.Header.Set(header[i], header[i+1])
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	return resp, string(body)
}

func TestListRooms(t *testing.T) {
	srv := newTestServer(t)
	resp, body := get(t, srv.URL+"/api/rooms")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status %d", resp.StatusCode)
	}
	var rooms []roomInfo
	if err := json.Unmarshal([]byte(body), &rooms); err != nil {
		t.Fatal(err)
	}
	if len(rooms) != 2 || rooms[0].ID != "sala-a" || rooms[1].Source != "es" || rooms[0].Live {
		t.Fatalf("rooms = %+v", rooms)
	}
}

func TestAuth(t *testing.T) {
	srv := newTestServer(t)
	if resp, _ := get(t, srv.URL+"/ingest/sala-a"); resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("ingest without token: %d", resp.StatusCode)
	}
	if resp, _ := get(t, srv.URL+"/api/admin/status"); resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("admin without token: %d", resp.StatusCode)
	}
	resp, body := get(t, srv.URL+"/api/admin/status", "Authorization", "Bearer secret")
	if resp.StatusCode != http.StatusOK || !strings.Contains(body, `"id":"sala-b"`) {
		t.Fatalf("admin with token: %d %s", resp.StatusCode, body)
	}
}

func TestPagesAndNotFound(t *testing.T) {
	srv := newTestServer(t)
	for _, p := range []string{"/", "/r/sala-a", "/operator/sala-a", "/admin"} {
		resp, _ := get(t, srv.URL+p)
		if resp.StatusCode != http.StatusOK || !strings.HasPrefix(resp.Header.Get("Content-Type"), "text/html") {
			t.Errorf("%s: %d %s", p, resp.StatusCode, resp.Header.Get("Content-Type"))
		}
	}
	if resp, _ := get(t, srv.URL+"/events/nope"); resp.StatusCode != http.StatusNotFound {
		t.Errorf("unknown room: %d", resp.StatusCode)
	}
	if resp, _ := get(t, srv.URL+"/export/sala-a/pdf"); resp.StatusCode != http.StatusNotFound {
		t.Errorf("unknown format: %d", resp.StatusCode)
	}
}

func TestLiveFlowAndExport(t *testing.T) {
	srv := newTestServer(t)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, srv.URL+"/events/sala-a", nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if ct := resp.Header.Get("Content-Type"); ct != "text/event-stream" {
		t.Fatalf("content-type %q", ct)
	}
	finals := make(chan string, 8)
	go func() {
		sc := bufio.NewScanner(resp.Body)
		event := ""
		for sc.Scan() {
			line := sc.Text()
			switch {
			case strings.HasPrefix(line, "event: "):
				event = strings.TrimPrefix(line, "event: ")
			case strings.HasPrefix(line, "data: ") && event == "final":
				finals <- strings.TrimPrefix(line, "data: ")
			}
		}
	}()

	ws, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ingest/sala-a?token=secret", nil)
	if err != nil {
		t.Fatal(err)
	}
	for range 10 {
		if err := ws.Write(ctx, websocket.MessageBinary, make([]byte, asr.BytesPerSecond/10)); err != nil {
			t.Fatal(err)
		}
	}
	select {
	case data := <-finals:
		var seg caption.Segment
		if err := json.Unmarshal([]byte(data), &seg); err != nil {
			t.Fatal(err)
		}
		if seg.Translations["es"] != "[es] Welcome to Nerdearla." {
			t.Fatalf("segment = %+v", seg)
		}
	case <-ctx.Done():
		t.Fatal("no final segment received")
	}
	ws.Close(websocket.StatusNormalClosure, "")

	_, vtt := get(t, srv.URL+"/export/sala-a/vtt?lang=es")
	if !strings.HasPrefix(vtt, "WEBVTT") || !strings.Contains(vtt, "00:00:00.000 --> 00:00:01.000\n[es] Welcome to Nerdearla.") {
		t.Fatalf("vtt = %q", vtt)
	}
}
```

- [ ] **Step 3: Run to see it fail**

Run: `go get github.com/coder/websocket && go test ./internal/web/`
Expected: FAIL (undefined: New, roomInfo).

- [ ] **Step 4: Write `internal/web/server.go`**

```go
// Package web serves the audience, operator and admin pages and the
// streaming endpoints behind them.
package web

import (
	"context"
	"crypto/subtle"
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/coder/websocket"

	"github.com/RchrdHndrcks/lenguaraz/internal/caption"
	"github.com/RchrdHndrcks/lenguaraz/internal/export"
	"github.com/RchrdHndrcks/lenguaraz/internal/room"
	"github.com/RchrdHndrcks/lenguaraz/internal/store"
)

//go:embed static
var embedded embed.FS

// Server routes requests to rooms.
type Server struct {
	rooms  map[string]*room.Room
	order  []*room.Room
	store  *store.Store
	token  string
	log    *slog.Logger
	static fs.FS
}

// New serves rooms in the given order. An empty token disables auth.
func New(rooms []*room.Room, st *store.Store, token string, log *slog.Logger) *Server {
	static, err := fs.Sub(embedded, "static")
	if err != nil {
		panic(err) // embedded tree is fixed at build time
	}
	s := &Server{rooms: map[string]*room.Room{}, order: rooms, store: st, token: token, log: log, static: static}
	for _, rm := range rooms {
		s.rooms[rm.Config().ID] = rm
	}
	return s
}

// Handler returns the HTTP routes.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.Handle("GET /static/", http.StripPrefix("/static/", http.FileServerFS(s.static)))
	mux.HandleFunc("GET /{$}", s.page("index.html"))
	mux.HandleFunc("GET /r/{room}", s.page("viewer.html"))
	mux.HandleFunc("GET /operator/{room}", s.page("operator.html"))
	mux.HandleFunc("GET /admin", s.page("admin.html"))
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) { io.WriteString(w, "ok") })
	mux.HandleFunc("GET /api/rooms", s.listRooms)
	mux.HandleFunc("GET /api/admin/status", s.auth(s.adminStatus))
	mux.HandleFunc("GET /events/{room}", s.events)
	mux.HandleFunc("GET /ingest/{room}", s.auth(s.ingest))
	mux.HandleFunc("GET /export/{room}/{format}", s.export)
	return mux
}

func (s *Server) page(name string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		data, err := fs.ReadFile(s.static, name)
		if err != nil {
			http.Error(w, "page missing", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write(data)
	}
}

func (s *Server) auth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if s.token == "" {
			next(w, r)
			return
		}
		got := r.URL.Query().Get("token")
		if h := r.Header.Get("Authorization"); strings.HasPrefix(h, "Bearer ") {
			got = strings.TrimPrefix(h, "Bearer ")
		}
		if subtle.ConstantTimeCompare([]byte(got), []byte(s.token)) != 1 {
			http.Error(w, "invalid token", http.StatusUnauthorized)
			return
		}
		next(w, r)
	}
}

func (s *Server) room(w http.ResponseWriter, r *http.Request) (*room.Room, bool) {
	rm, ok := s.rooms[r.PathValue("room")]
	if !ok {
		http.Error(w, "unknown room", http.StatusNotFound)
	}
	return rm, ok
}

type roomInfo struct {
	ID      string   `json:"id"`
	Title   string   `json:"title"`
	Source  string   `json:"source"`
	Targets []string `json:"targets"`
	Live    bool     `json:"live"`
}

func (s *Server) listRooms(w http.ResponseWriter, _ *http.Request) {
	out := make([]roomInfo, 0, len(s.order))
	for _, rm := range s.order {
		st := rm.Status()
		out = append(out, roomInfo{ID: st.ID, Title: st.Title, Source: st.Source, Targets: st.Targets, Live: st.Live})
	}
	writeJSON(w, out)
}

func (s *Server) adminStatus(w http.ResponseWriter, _ *http.Request) {
	out := make([]room.Status, 0, len(s.order))
	for _, rm := range s.order {
		out = append(out, rm.Status())
	}
	writeJSON(w, out)
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v)
}

// events streams a room's captions with Server-Sent Events.
func (s *Server) events(w http.ResponseWriter, r *http.Request) {
	rm, ok := s.room(w, r)
	if !ok {
		return
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}
	h := w.Header()
	h.Set("Content-Type", "text/event-stream")
	h.Set("Cache-Control", "no-cache")
	h.Set("X-Accel-Buffering", "no")

	msgs, recent, cancel := rm.Hub().Subscribe(64)
	defer cancel()
	writeEvent(w, "status", map[string]bool{"live": rm.Status().Live})
	for _, seg := range recent {
		writeEvent(w, "final", seg)
	}
	flusher.Flush()

	ping := time.NewTicker(15 * time.Second)
	defer ping.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case m, ok := <-msgs:
			if !ok {
				return // dropped for falling behind; the browser reconnects
			}
			if writeEvent(w, m.Event, m.Data) != nil {
				return
			}
			flusher.Flush()
		case <-ping.C:
			if _, err := io.WriteString(w, ": ping\n\n"); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}

func writeEvent(w io.Writer, event string, data any) error {
	b, err := json.Marshal(data)
	if err != nil {
		return err
	}
	_, err = fmt.Fprintf(w, "event: %s\ndata: %s\n\n", event, b)
	return err
}

// ingest receives an operator's PCM audio over a WebSocket.
func (s *Server) ingest(w http.ResponseWriter, r *http.Request) {
	rm, ok := s.room(w, r)
	if !ok {
		return
	}
	if rm.Status().Live {
		http.Error(w, room.ErrBusy.Error(), http.StatusConflict)
		return
	}
	c, err := websocket.Accept(w, r, nil)
	if err != nil {
		return // Accept already wrote the HTTP error
	}
	defer c.CloseNow()
	c.SetReadLimit(1 << 20)
	ctx := r.Context()
	id := rm.Config().ID
	s.log.Info("operator connected", "room", id)

	audio := make(chan []byte, 50)
	done := make(chan error, 1)
	go func() { done <- rm.Run(ctx, audio) }()

	var runErr error
	finished := false
read:
	for {
		typ, data, err := c.Read(ctx)
		if err != nil {
			break
		}
		if typ != websocket.MessageBinary {
			continue
		}
		select {
		case audio <- data:
		case runErr = <-done:
			finished = true
			break read
		}
	}
	close(audio)
	if !finished {
		runErr = <-done
	}
	s.log.Info("operator disconnected", "room", id)
	switch {
	case errors.Is(runErr, room.ErrBusy):
		c.Close(websocket.StatusPolicyViolation, "room busy")
	case runErr != nil && !errors.Is(runErr, context.Canceled):
		s.log.Error("room session failed", "room", id, "err", runErr)
		c.Close(websocket.StatusInternalError, "session failed")
	default:
		c.Close(websocket.StatusNormalClosure, "")
	}
}

func (s *Server) export(w http.ResponseWriter, r *http.Request) {
	rm, ok := s.room(w, r)
	if !ok {
		return
	}
	cfg := rm.Config()
	lang := r.URL.Query().Get("lang")
	if lang == "" {
		lang = cfg.Source
	}
	render, contentType := map[string]func([]caption.Segment, string) string{
		"vtt": export.VTT, "srt": export.SRT, "txt": export.TXT,
	}, map[string]string{
		"vtt": "text/vtt; charset=utf-8", "srt": "application/x-subrip; charset=utf-8", "txt": "text/plain; charset=utf-8",
	}
	format := r.PathValue("format")
	fn, ok := render[format]
	if !ok {
		http.Error(w, "unknown format", http.StatusNotFound)
		return
	}
	segs, err := s.store.Load(cfg.ID)
	if err != nil {
		http.Error(w, "cannot read transcript", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", contentType[format])
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s-%s.%s"`, cfg.ID, lang, format))
	io.WriteString(w, fn(segs, lang))
}
```

- [ ] **Step 5: Run tests**

Run: `go test -race ./internal/web/`
Expected: `ok`.

- [ ] **Step 6: Write `cmd/lenguaraz/main.go`**

```go
// Command lenguaraz serves real-time conference captions.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"google.golang.org/genai"

	"github.com/RchrdHndrcks/lenguaraz/internal/asr"
	"github.com/RchrdHndrcks/lenguaraz/internal/config"
	"github.com/RchrdHndrcks/lenguaraz/internal/room"
	"github.com/RchrdHndrcks/lenguaraz/internal/store"
	"github.com/RchrdHndrcks/lenguaraz/internal/translate"
	"github.com/RchrdHndrcks/lenguaraz/internal/web"
)

func main() {
	addr := flag.String("addr", ":8080", "listen address")
	rooms := flag.String("config", "rooms.yaml", "rooms file")
	data := flag.String("data", "data", "directory for transcripts")
	fake := flag.Bool("fake", false, "use scripted transcription and translation (no API key needed)")
	flag.Parse()

	log := slog.New(slog.NewTextHandler(os.Stderr, nil))
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := run(ctx, log, *addr, *rooms, *data, *fake); err != nil {
		log.Error("fatal", "err", err)
		os.Exit(1)
	}
}

func run(ctx context.Context, log *slog.Logger, addr, roomsPath, dataDir string, fake bool) error {
	cfg, err := config.Load(roomsPath)
	if err != nil {
		return err
	}
	st, err := store.New(dataDir)
	if err != nil {
		return err
	}

	var engine asr.Engine = asr.Fake{}
	var translator translate.Translator = translate.Fake{}
	if !fake {
		key := os.Getenv("GEMINI_API_KEY")
		if key == "" {
			return errors.New("GEMINI_API_KEY is required (or run with -fake)")
		}
		client, err := genai.NewClient(ctx, &genai.ClientConfig{APIKey: key, Backend: genai.BackendGeminiAPI})
		if err != nil {
			return fmt.Errorf("gemini client: %w", err)
		}
		engine = &asr.Gemini{Client: client, Model: os.Getenv("ASR_MODEL"), Log: log}
		translator = translate.Gemini{Client: client, Model: os.Getenv("TRANSLATE_MODEL")}
	}

	token := os.Getenv("ADMIN_TOKEN")
	if token == "" {
		log.Warn("ADMIN_TOKEN is not set: anyone can stream audio and see the admin panel")
	}

	deps := room.Deps{ASR: engine, Translator: translator, Store: st, Log: log}
	var rs []*room.Room
	for _, rc := range cfg.Rooms {
		rm, err := room.New(rc, deps)
		if err != nil {
			return err
		}
		rs = append(rs, rm)
	}

	srv := &http.Server{
		Addr:              addr,
		Handler:           web.New(rs, st, token, log).Handler(),
		ReadHeaderTimeout: 10 * time.Second,
		// Cancel long-lived SSE and WebSocket requests on shutdown.
		BaseContext: func(net.Listener) context.Context { return ctx },
	}
	errc := make(chan error, 1)
	go func() { errc <- srv.ListenAndServe() }()
	log.Info("lenguaraz listening", "addr", addr, "rooms", len(rs), "fake", fake)

	select {
	case err := <-errc:
		return err
	case <-ctx.Done():
	}
	shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	return srv.Shutdown(shutdown)
}
```

- [ ] **Step 7: Smoke-run the binary in fake mode**

```bash
go run ./cmd/lenguaraz -fake -data /tmp/lz-data &
sleep 2
curl -s localhost:8080/api/rooms; echo
curl -s localhost:8080/healthz; echo
kill %1
```
Expected: JSON with `sala-a` and `sala-b`; `ok`; log line "ADMIN_TOKEN is not set…".

- [ ] **Step 8: Commit**

```bash
git add internal/web cmd/lenguaraz go.mod go.sum
git commit -m "Add HTTP server with SSE captions and audio ingest"
```

---

### Task 9: Audience pages (index + viewer in three modes)

**Files:**
- Create: `internal/web/static/css/app.css`, `internal/web/static/js/index.js`, `internal/web/static/js/viewer.js`
- Modify (replace stubs): `internal/web/static/index.html`, `internal/web/static/viewer.html`

**Interfaces:**
- Consumes: `GET /api/rooms`, `GET /events/{room}` (events `status`, `final`, `interim`), `GET /export/{room}/{fmt}?lang=`.
- Viewer URL contract: `/r/{room}?lang=en|es|pt&mode=mobile|screen|overlay` (defaults: first target language, `mobile`).

- [ ] **Step 1: Write `internal/web/static/css/app.css`**

```css
:root {
  --bg: #0e0f12;
  --card: #17191e;
  --line: #2a2d35;
  --fg: #f4f1ea;
  --muted: #9b978f;
  --accent: #f2b233;
  --live: #3ddc84;
  --err: #ff6b5b;
  --font: "Atkinson Hyperlegible", system-ui, sans-serif;
  color-scheme: dark;
}
* { box-sizing: border-box; }
html, body { margin: 0; background: var(--bg); color: var(--fg); font-family: var(--font); }
a { color: var(--accent); }
button, input, select { font: inherit; }

header.bar { display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-bottom: 1px solid var(--line); position: sticky; top: 0; background: var(--bg); z-index: 1; }
.brand { font-weight: 700; color: var(--fg); text-decoration: none; letter-spacing: .02em; }
.brand::before { content: "◖ "; color: var(--accent); }
#title { flex: 1; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.badge { font-size: .75rem; padding: 2px 10px; border-radius: 999px; border: 1px solid var(--line); color: var(--muted); white-space: nowrap; }
.badge.live { color: var(--bg); background: var(--live); border-color: var(--live); font-weight: 700; }

main { padding: 16px; max-width: 920px; margin: 0 auto; }
h1 { font-size: 1.6rem; margin: 8px 0 4px; }
.lede { color: var(--muted); margin: 0 0 20px; }
.rooms { display: grid; gap: 12px; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); }
.card { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 16px; }
.card h2 { font-size: 1.15rem; margin: 0 0 6px; display: flex; gap: 8px; align-items: center; justify-content: space-between; }
.small { font-size: .85rem; color: var(--muted); }
.langs { display: flex; gap: 8px; flex-wrap: wrap; margin: 12px 0; }
.langs a, .langs button { padding: 8px 14px; border-radius: 8px; border: 1px solid var(--line); background: transparent; color: var(--fg); text-decoration: none; cursor: pointer; min-height: 40px; }
.langs .on { background: var(--accent); color: var(--bg); border-color: var(--accent); font-weight: 700; }

/* Captions: each line is a <p><span>; the span carries the overlay box. */
#captions p { margin: 0 0 .55em; line-height: 1.35; }
#captions p.untranslated span { color: var(--muted); font-style: italic; }
#interim span { color: var(--muted); }

body[data-mode="mobile"] #captions { font-size: clamp(1.25rem, 5.2vw, 1.8rem); padding-bottom: 35vh; }

body:not([data-mode="mobile"]) header.bar,
body:not([data-mode="mobile"]) .only-mobile { display: none; }

body[data-mode="screen"] main { max-width: none; min-height: 100vh; display: flex; flex-direction: column; justify-content: flex-end; padding: 4vh 6vw; }
body[data-mode="screen"] #captions { font-size: 4.6vw; font-weight: 700; }

html.transparent, html.transparent body { background: transparent; }
body[data-mode="overlay"] main { max-width: none; position: fixed; left: 0; right: 0; bottom: 0; padding: 0 6vw 6vh; text-align: center; }
body[data-mode="overlay"] #captions { font-size: 3.4vw; font-weight: 700; }
body[data-mode="overlay"] #captions span { background: rgba(0, 0, 0, .78); color: #fff; padding: .08em .35em; box-decoration-break: clone; -webkit-box-decoration-break: clone; }

.meter { height: 10px; background: var(--line); border-radius: 5px; overflow: hidden; }
.meter > div { height: 100%; width: 0; background: var(--live); transition: width 80ms linear; }
.row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin: 10px 0; }
.btn { padding: 10px 16px; border-radius: 8px; border: 1px solid var(--line); background: var(--card); color: var(--fg); cursor: pointer; }
.btn.primary { background: var(--accent); color: var(--bg); border-color: var(--accent); font-weight: 700; }
.btn:disabled { opacity: .5; cursor: default; }
input[type=text], input[type=password], select { background: var(--bg); color: var(--fg); border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; max-width: 100%; }
.err { color: var(--err); }
table { width: 100%; border-collapse: collapse; font-size: .9rem; }
th, td { text-align: left; padding: 8px 6px; border-bottom: 1px solid var(--line); vertical-align: top; }
.table-wrap { overflow-x: auto; }
```

- [ ] **Step 2: Write `internal/web/static/index.html` and `js/index.js`**

`index.html`:

```html
<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Lenguaraz</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:wght@400;700&display=swap">
  <link rel="stylesheet" href="/static/css/app.css">
</head>
<body data-mode="mobile">
  <header class="bar"><a class="brand" href="/">Lenguaraz</a><span id="title"></span></header>
  <main>
    <h1>Subtítulos en vivo</h1>
    <p class="lede">Elegí la sala y el idioma en el que querés leer la charla.</p>
    <section id="rooms" class="rooms" aria-live="polite"></section>
  </main>
  <script type="module" src="/static/js/index.js"></script>
</body>
</html>
```

`js/index.js`:

```js
const NAMES = { en: 'English', es: 'Español', pt: 'Português' };

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function card(room) {
  const langs = [room.source, ...room.targets];
  const badge = el('span', { className: room.live ? 'badge live' : 'badge', textContent: room.live ? 'EN VIVO' : 'sin señal' });
  const links = langs.map((l) =>
    el('a', { href: `/r/${room.id}?lang=${l}`, textContent: NAMES[l] + (l === room.source ? ' · original' : '') }));
  const main = room.targets[0] ?? room.source;
  return el('article', { className: 'card' },
    el('h2', {}, el('span', { textContent: room.title }), badge),
    el('div', { className: 'small', textContent: `Idioma de la charla: ${NAMES[room.source]}` }),
    el('nav', { className: 'langs' }, ...links),
    el('div', { className: 'small' },
      el('a', { href: `/r/${room.id}?lang=${main}&mode=screen`, textContent: 'Pantalla' }), ' · ',
      el('a', { href: `/r/${room.id}?lang=${main}&mode=overlay`, textContent: 'Overlay OBS' })));
}

async function load() {
  try {
    const rooms = await (await fetch('/api/rooms')).json();
    document.getElementById('rooms').replaceChildren(...rooms.map(card));
  } catch {
    // keep the last rendered list; the next poll retries
  }
}

load();
setInterval(load, 10000);
```

- [ ] **Step 3: Write `internal/web/static/viewer.html` and `js/viewer.js`**

`viewer.html`:

```html
<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Lenguaraz</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:wght@400;700&display=swap">
  <link rel="stylesheet" href="/static/css/app.css">
</head>
<body data-mode="mobile">
  <header class="bar">
    <a class="brand" href="/">Lenguaraz</a>
    <span id="title"></span>
    <span id="status" class="badge">…</span>
  </header>
  <main>
    <nav id="langs" class="langs only-mobile" aria-label="Idioma"></nav>
    <section id="captions">
      <div id="lines" aria-live="polite"></div>
      <p id="interim" aria-hidden="true"></p>
    </section>
    <p id="exports" class="small only-mobile"></p>
  </main>
  <script type="module" src="/static/js/viewer.js"></script>
</body>
</html>
```

`js/viewer.js`:

```js
const NAMES = { en: 'English', es: 'Español', pt: 'Português' };
const MAX_LINES = { mobile: 500, screen: 3, overlay: 2 };

const params = new URLSearchParams(location.search);
const roomId = decodeURIComponent(location.pathname.split('/').pop());
const mode = Object.hasOwn(MAX_LINES, params.get('mode')) ? params.get('mode') : 'mobile';
document.body.dataset.mode = mode;
if (mode === 'overlay') document.documentElement.classList.add('transparent');

const $ = (id) => document.getElementById(id);
const segments = new Map(); // id → segment
let room;
let lang;
let interim = '';

function line(text, className = '') {
  const p = document.createElement('p');
  p.className = className;
  const span = document.createElement('span');
  span.textContent = text;
  p.append(span);
  return p;
}

function textOf(seg) {
  if (seg.lang === lang) return { text: seg.text, ok: true };
  const t = seg.translations?.[lang];
  return t ? { text: t, ok: true } : { text: seg.text, ok: false };
}

function showsInterim() {
  return lang === room.source && interim !== '';
}

function nearBottom() {
  return window.innerHeight + window.scrollY >= document.body.scrollHeight - 120;
}

function renderLines() {
  const stick = nearBottom();
  const keep = Math.max(1, MAX_LINES[mode] - (mode !== 'mobile' && showsInterim() ? 1 : 0));
  const ordered = [...segments.values()].sort((a, b) => a.id - b.id).slice(-keep);
  $('lines').replaceChildren(...ordered.map((s) => {
    const { text, ok } = textOf(s);
    return line(text, ok ? '' : 'untranslated');
  }));
  renderInterim();
  if (mode === 'mobile' && stick) window.scrollTo(0, document.body.scrollHeight);
}

function renderInterim() {
  const span = document.createElement('span');
  span.textContent = showsInterim() ? interim : '';
  $('interim').replaceChildren(span);
}

function setLive(live) {
  const badge = $('status');
  badge.textContent = live ? 'EN VIVO' : 'sin señal';
  badge.classList.toggle('live', live);
}

function renderLangs() {
  const langs = [room.source, ...room.targets];
  $('langs').replaceChildren(...langs.map((l) => {
    const b = document.createElement('button');
    b.textContent = NAMES[l] ?? l;
    b.className = l === lang ? 'on' : '';
    b.setAttribute('aria-pressed', String(l === lang));
    b.onclick = () => {
      lang = l;
      params.set('lang', l);
      history.replaceState(null, '', `?${params}`);
      renderLangs();
      renderExports();
      renderLines();
    };
    return b;
  }));
}

function renderExports() {
  const links = ['vtt', 'srt', 'txt'].map((f) => {
    const a = document.createElement('a');
    a.href = `/export/${roomId}/${f}?lang=${lang}`;
    a.textContent = f.toUpperCase();
    return a;
  });
  $('exports').replaceChildren('Descargar transcripción: ', links[0], ' · ', links[1], ' · ', links[2]);
}

async function main() {
  const rooms = await (await fetch('/api/rooms')).json();
  room = rooms.find((r) => r.id === roomId);
  if (!room) {
    $('lines').replaceChildren(line('Sala no encontrada.'));
    return;
  }
  const langs = [room.source, ...room.targets];
  lang = langs.includes(params.get('lang')) ? params.get('lang') : (room.targets[0] ?? room.source);
  document.title = `${room.title} · Lenguaraz`;
  $('title').textContent = room.title;
  renderLangs();
  renderExports();
  setLive(room.live);

  const events = new EventSource(`/events/${encodeURIComponent(roomId)}`);
  events.addEventListener('final', (e) => {
    const seg = JSON.parse(e.data);
    segments.set(seg.id, seg);
    if (segments.size > MAX_LINES.mobile + 50) segments.delete(Math.min(...segments.keys()));
    interim = '';
    renderLines();
  });
  events.addEventListener('interim', (e) => {
    interim = JSON.parse(e.data).text;
    if (lang === room.source) renderInterim();
  });
  events.addEventListener('status', (e) => {
    const { live } = JSON.parse(e.data);
    setLive(live);
    if (!live) {
      interim = '';
      renderInterim();
    }
  });
  events.onerror = () => setLive(false);
}

main();
```

- [ ] **Step 4: Manual check in the browser (fake mode)**

```bash
go run ./cmd/lenguaraz -fake -data /tmp/lz-data
```
Then in another terminal, push fake audio into `sala-a` (no browser operator yet):
```bash
cat > /tmp/lz-push.go <<'EOF'
package main
import ("context";"time";"github.com/coder/websocket")
func main(){ c,_,err:=websocket.Dial(context.Background(),"ws://localhost:8080/ingest/sala-a",nil); if err!=nil{panic(err)}
 for i:=0;i<300;i++{ c.Write(context.Background(),websocket.MessageBinary,make([]byte,3200)); time.Sleep(100*time.Millisecond)} ; c.Close(1000,"") }
EOF
cp /tmp/lz-push.go ./push_tmp.go && go run ./push_tmp.go; rm push_tmp.go
```
Open and check (use the browser tools or a real browser):
- `http://localhost:8080/` lists both rooms; `sala-a` shows EN VIVO while pushing.
- `/r/sala-a?lang=en` shows grey interim text then finals; `?lang=es` shows `[es] …`; switching language re-renders history.
- `/r/sala-a?mode=screen` shows at most 3 big lines; `?mode=overlay` shows 2 boxed lines on a transparent background.
- Phone width (375 px): no horizontal scroll.

- [ ] **Step 5: Commit**

```bash
git add internal/web/static
git commit -m "Add audience pages with mobile, screen and overlay modes"
```

---

### Task 10: Operator console and production panel

**Files:**
- Create: `internal/web/static/js/pcm-worklet.js`, `internal/web/static/js/operator.js`, `internal/web/static/js/admin.js`
- Modify (replace stubs): `internal/web/static/operator.html`, `internal/web/static/admin.html`

**Interfaces:**
- Consumes: `GET /ingest/{room}?token=` (WebSocket, binary PCM16 16 kHz mono), `GET /events/{room}`, `GET /api/rooms`, `GET /api/admin/status` (Bearer token), `GET /export/...`.
- Operator URL contract: `/operator/{room}?token=…`; the token is also remembered in `localStorage` (`lenguaraz.token`) when available.

- [ ] **Step 1: Write `js/pcm-worklet.js`**

```js
// Converts the (mono) input to 16 kHz PCM16 and posts 100 ms chunks.
// The AudioContext is created at 16 kHz where the browser allows it, so the
// ratio is usually 1; otherwise this decimates by averaging each window,
// which doubles as a crude low-pass filter.
class PCM16k extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / 16000;
    this.acc = 0;
    this.count = 0;
    this.pos = 0;
    this.out = new Int16Array(1600);
    this.n = 0;
  }

  process(inputs) {
    const input = inputs[0][0];
    if (!input) return true;
    for (let i = 0; i < input.length; i++) {
      this.acc += input[i];
      this.count++;
      this.pos += 1;
      if (this.pos >= this.ratio) {
        this.pos -= this.ratio;
        const s = Math.max(-1, Math.min(1, this.acc / this.count));
        this.acc = 0;
        this.count = 0;
        this.out[this.n++] = s < 0 ? s * 0x8000 : s * 0x7fff;
        if (this.n === this.out.length) {
          this.port.postMessage(this.out.buffer, [this.out.buffer]);
          this.out = new Int16Array(1600);
          this.n = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor('pcm-16k', PCM16k);
```

- [ ] **Step 2: Write `operator.html`**

```html
<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Operador · Lenguaraz</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:wght@400;700&display=swap">
  <link rel="stylesheet" href="/static/css/app.css">
</head>
<body data-mode="mobile">
  <header class="bar">
    <a class="brand" href="/">Lenguaraz</a>
    <span id="title">Operador</span>
    <span id="status" class="badge">detenido</span>
  </header>
  <main>
    <section class="card">
      <h2>Fuente de audio</h2>
      <div class="row">
        <label for="token">Token</label>
        <input id="token" type="password" autocomplete="off" placeholder="ADMIN_TOKEN">
      </div>
      <div class="row">
        <select id="source" aria-label="Fuente"><option value="file">Archivo de audio</option></select>
        <button id="detect" class="btn">Detectar micrófonos</button>
      </div>
      <div class="row" id="file-row">
        <input id="file" type="file" accept="audio/*,video/*">
        <span class="small">o probá con <a href="#" data-sample="en">sample EN</a> · <a href="#" data-sample="es">sample ES</a></span>
      </div>
      <audio id="player" controls hidden></audio>
      <div class="row">
        <button id="start" class="btn primary">Transmitir</button>
        <button id="stop" class="btn" disabled>Detener</button>
        <span id="sent" class="small"></span>
      </div>
      <div class="meter" aria-hidden="true"><div id="level"></div></div>
      <p id="error" class="err small"></p>
    </section>
    <section class="card" style="margin-top:12px">
      <h2>Salida (idioma original)</h2>
      <div id="captions"><div id="lines"></div><p id="interim"></p></div>
      <p class="small" id="links"></p>
    </section>
  </main>
  <script type="module" src="/static/js/operator.js"></script>
</body>
</html>
```

- [ ] **Step 3: Serve the samples from the binary**

The operator page offers the bundled samples. `embed` cannot reach `samples/` from `internal/web`, so serve that directory from disk (relative to the working directory; the Dockerfile in Task 11 copies it there). In `Handler()` add:

```go
	mux.Handle("GET /samples/", http.StripPrefix("/samples/", http.FileServer(http.Dir("samples"))))
```

and in the Dockerfile (Task 11) copy `samples/` next to the binary's working directory. Add a test line to `TestPagesAndNotFound`:

```go
	if resp, _ := get(t, srv.URL+"/samples/missing.wav"); resp.StatusCode != http.StatusNotFound {
		t.Errorf("missing sample: %d", resp.StatusCode)
	}
```

Run: `go test ./internal/web/` → `ok`.

- [ ] **Step 4: Write `js/operator.js`**

```js
const roomId = decodeURIComponent(location.pathname.split('/').pop());
const params = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);

function storedToken() {
  try { return localStorage.getItem('lenguaraz.token') ?? ''; } catch { return ''; }
}
function storeToken(t) {
  try { localStorage.setItem('lenguaraz.token', t); } catch { /* private mode */ }
}
$('token').value = params.get('token') ?? storedToken();

let ctx, node, ws, stream, player, sentBytes = 0;

function setStatus(text, live = false) {
  $('status').textContent = text;
  $('status').classList.toggle('live', live);
}
function fail(msg) {
  $('error').textContent = msg;
  stop();
}

async function detect() {
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true });
    s.getTracks().forEach((t) => t.stop());
    const devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput');
    const select = $('source');
    select.replaceChildren(new Option('Archivo de audio', 'file'),
      ...devices.map((d, i) => new Option(`Micrófono: ${d.label || `entrada ${i + 1}`}`, d.deviceId)));
    select.value = devices[0]?.deviceId ?? 'file';
    toggleFileRow();
  } catch (e) {
    $('error').textContent = `No se pudo acceder al micrófono: ${e.message}`;
  }
}

function toggleFileRow() {
  const isFile = $('source').value === 'file';
  $('file-row').hidden = !isFile;
  $('player').hidden = !isFile || !$('player').src;
}

function loadFile(url) {
  // A fresh <audio> per source: createMediaElementSource works once per element.
  const fresh = document.createElement('audio');
  fresh.id = 'player';
  fresh.controls = true;
  fresh.src = url;
  $('player').replaceWith(fresh);
  toggleFileRow();
}

async function start() {
  $('error').textContent = '';
  const token = $('token').value.trim();
  storeToken(token);
  const isFile = $('source').value === 'file';
  player = $('player');
  if (isFile && !player.src) return fail('Elegí un archivo de audio primero.');

  try {
    ctx = new AudioContext({ sampleRate: 16000 });
  } catch {
    ctx = new AudioContext(); // the worklet resamples
  }
  await ctx.audioWorklet.addModule('/static/js/pcm-worklet.js');
  node = new AudioWorkletNode(ctx, 'pcm-16k', { channelCount: 1, channelCountMode: 'explicit', channelInterpretation: 'speakers' });
  const mute = ctx.createGain();
  mute.gain.value = 0;
  node.connect(mute).connect(ctx.destination); // keeps the worklet pulled

  let src;
  if (isFile) {
    src = ctx.createMediaElementSource(player);
    src.connect(ctx.destination); // the operator hears the file
  } else {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { deviceId: { exact: $('source').value }, channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    src = ctx.createMediaStreamSource(stream);
  }
  src.connect(node);

  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ingest/${encodeURIComponent(roomId)}?token=${encodeURIComponent(token)}`);
  ws.binaryType = 'arraybuffer';
  ws.onopen = () => {
    setStatus('EN VIVO', true);
    $('start').disabled = true;
    $('stop').disabled = false;
    if (isFile) player.play();
  };
  ws.onclose = (e) => {
    if (e.code === 1008) fail('Otra persona ya está transmitiendo en esta sala.');
    else if (e.code === 1006 && sentBytes === 0) fail('No se pudo conectar: revisá el token o si la sala ya está en uso.');
    else stop();
  };
  sentBytes = 0;
  node.port.onmessage = (e) => {
    if (ws.readyState !== WebSocket.OPEN) return;
    ws.send(e.data);
    sentBytes += e.data.byteLength;
    $('sent').textContent = `${(sentBytes / 32000).toFixed(0)} s enviados`;
    const pcm = new Int16Array(e.data);
    let sum = 0;
    for (let i = 0; i < pcm.length; i++) sum += pcm[i] * pcm[i];
    const rms = Math.sqrt(sum / pcm.length) / 32768;
    $('level').style.width = `${Math.min(100, rms * 300)}%`;
  };
  if (isFile) player.onended = () => stop();
}

function stop() {
  ws?.readyState === WebSocket.OPEN && ws.close(1000);
  ws = null;
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  player?.pause();
  ctx?.close();
  ctx = null;
  $('level').style.width = '0';
  $('start').disabled = false;
  $('stop').disabled = true;
  setStatus('detenido');
  if ($('source').value === 'file' && $('player').src) loadFile($('player').src);
}

function preview(room) {
  const lines = $('lines');
  const events = new EventSource(`/events/${encodeURIComponent(roomId)}`);
  events.addEventListener('final', (e) => {
    const seg = JSON.parse(e.data);
    const p = document.createElement('p');
    p.textContent = seg.text;
    lines.append(p);
    while (lines.children.length > 6) lines.firstChild.remove();
    $('interim').textContent = '';
  });
  events.addEventListener('interim', (e) => { $('interim').textContent = JSON.parse(e.data).text; });
  const main = room.targets[0] ?? room.source;
  $('links').innerHTML = '';
  for (const [label, href] of [
    ['Vista público', `/r/${roomId}?lang=${main}`],
    ['Pantalla', `/r/${roomId}?lang=${main}&mode=screen`],
    ['Overlay OBS', `/r/${roomId}?lang=${main}&mode=overlay`],
  ]) {
    const a = document.createElement('a');
    a.href = href;
    a.target = '_blank';
    a.textContent = label;
    $('links').append(a, ' · ');
  }
  $('links').lastChild.remove();
}

async function main() {
  const rooms = await (await fetch('/api/rooms')).json();
  const room = rooms.find((r) => r.id === roomId);
  if (!room) {
    $('error').textContent = 'Sala no encontrada.';
    $('start').disabled = true;
    return;
  }
  document.title = `Operador · ${room.title}`;
  $('title').textContent = `Operador · ${room.title} (${room.source.toUpperCase()})`;
  preview(room);
  $('detect').onclick = detect;
  $('source').onchange = toggleFileRow;
  $('file').onchange = (e) => e.target.files[0] && loadFile(URL.createObjectURL(e.target.files[0]));
  for (const a of document.querySelectorAll('[data-sample]')) {
    a.onclick = (e) => { e.preventDefault(); loadFile(`/samples/${a.dataset.sample}.wav`); };
  }
  $('start').onclick = () => start().catch((e) => fail(e.message));
  $('stop').onclick = stop;
  toggleFileRow();
}

main();
```

- [ ] **Step 5: Write `admin.html` and `js/admin.js`**

`admin.html`:

```html
<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Producción · Lenguaraz</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:wght@400;700&display=swap">
  <link rel="stylesheet" href="/static/css/app.css">
</head>
<body data-mode="mobile">
  <header class="bar"><a class="brand" href="/">Lenguaraz</a><span id="title">Panel de producción</span><span id="updated" class="badge">—</span></header>
  <main style="max-width:1200px">
    <div class="row">
      <label for="token">Token</label>
      <input id="token" type="password" autocomplete="off" placeholder="ADMIN_TOKEN">
    </div>
    <p id="error" class="err small"></p>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Sala</th><th>Estado</th><th>Público</th><th>Segmentos</th><th>Último</th><th>Latencia trad.</th><th>Errores</th><th>Links</th></tr></thead>
        <tbody id="rows"></tbody>
      </table>
    </div>
  </main>
  <script type="module" src="/static/js/admin.js"></script>
</body>
</html>
```

`js/admin.js`:

```js
const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);

function storedToken() {
  try { return localStorage.getItem('lenguaraz.token') ?? ''; } catch { return ''; }
}
$('token').value = params.get('token') ?? storedToken();
$('token').onchange = () => { try { localStorage.setItem('lenguaraz.token', $('token').value); } catch { /* private mode */ } refresh(); };

function ago(iso) {
  if (!iso || iso.startsWith('0001')) return '—';
  const s = Math.round((Date.now() - new Date(iso)) / 1000);
  return s < 60 ? `hace ${s} s` : `hace ${Math.round(s / 60)} min`;
}

function cell(...children) {
  const td = document.createElement('td');
  td.append(...children);
  return td;
}

function link(label, href) {
  const a = document.createElement('a');
  a.href = href;
  a.target = '_blank';
  a.textContent = label;
  return a;
}

function row(s) {
  const tr = document.createElement('tr');
  const state = document.createElement('span');
  state.className = s.live ? 'badge live' : 'badge';
  state.textContent = s.live ? 'EN VIVO' : 'idle';
  const errors = document.createElement('span');
  errors.textContent = String(s.errors);
  if (s.lastError) {
    errors.className = 'err';
    errors.title = s.lastError;
  }
  const token = encodeURIComponent($('token').value);
  const links = [link('operador', `/operator/${s.id}?token=${token}`), ' · ', link('ver', `/r/${s.id}`)];
  for (const l of [s.source, ...s.targets]) links.push(' · ', link(`vtt ${l}`, `/export/${s.id}/vtt?lang=${l}`));
  tr.append(
    cell(`${s.title} (${s.id})`),
    cell(state),
    cell(String(s.viewers)),
    cell(String(s.segments)),
    cell(ago(s.lastSegmentAt)),
    cell(s.segments ? `${s.avgLatencyMs} ms` : '—'),
    cell(errors),
    cell(...links),
  );
  return tr;
}

async function refresh() {
  try {
    const res = await fetch('/api/admin/status', { headers: { Authorization: `Bearer ${$('token').value}` } });
    if (res.status === 401) {
      $('error').textContent = 'Token inválido.';
      return;
    }
    const rooms = await res.json();
    $('error').textContent = '';
    $('rows').replaceChildren(...rooms.map(row));
    $('updated').textContent = new Date().toLocaleTimeString();
  } catch (e) {
    $('error').textContent = `Sin conexión: ${e.message}`;
  }
}

refresh();
setInterval(refresh, 2000);
```

- [ ] **Step 6: Manual end-to-end check with the real API**

```bash
export ADMIN_TOKEN=dev
go run ./cmd/lenguaraz -data /tmp/lz-data   # GEMINI_API_KEY must be set
```
In Chrome:
1. `http://localhost:8080/operator/sala-a?token=dev` → "sample EN" → Transmitir. Expect: meter moves, "EN VIVO", original captions in the preview within ~1–2 s.
2. At the same time `http://localhost:8080/operator/sala-b?token=dev` → "sample ES" → Transmitir (two rooms in parallel).
3. `/r/sala-a?lang=es`, `/r/sala-a?lang=pt`, `/r/sala-b?lang=en`: translations appear per sentence.
4. `/admin?token=dev`: both rooms EN VIVO, segments increase, latency shown, 0 errors.
5. Mic: "Detectar micrófonos", pick the built-in mic, speak; captions follow.
6. A wrong token shows "No se pudo conectar…".

Fix anything that fails before committing.

- [ ] **Step 7: Commit**

```bash
git add internal/web
git commit -m "Add operator console and production panel"
```

---

### Task 11: Packaging, README and deployment on the Mac Mini

**Files:**
- Create: `Dockerfile`, `.dockerignore`, `docker-compose.yml`, `README.md`, `.gitignore`

- [ ] **Step 1: Write `.gitignore` and `.dockerignore`**

`.gitignore`:
```
/data/
.env
*.log
```

`.dockerignore`:
```
.git
data
.env
docs
```

- [ ] **Step 2: Write `Dockerfile`**

```dockerfile
FROM golang:1.26-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/lenguaraz ./cmd/lenguaraz \
 && mkdir -p /out/data

FROM gcr.io/distroless/static-debian12:nonroot
WORKDIR /app
COPY --from=build /out/lenguaraz /app/lenguaraz
COPY --from=build --chown=65532:65532 /out/data /data
COPY rooms.yaml /app/rooms.yaml
COPY samples/*.wav /app/samples/
EXPOSE 8080
ENTRYPOINT ["/app/lenguaraz", "-config", "/app/rooms.yaml", "-data", "/data"]
```

- [ ] **Step 3: Write `docker-compose.yml`**

```yaml
services:
  lenguaraz:
    build: .
    ports:
      - "8080:8080"
    environment:
      GEMINI_API_KEY: ${GEMINI_API_KEY}
      ADMIN_TOKEN: ${ADMIN_TOKEN}
    volumes:
      - ./rooms.yaml:/app/rooms.yaml:ro
      - lenguaraz-data:/data
    restart: unless-stopped

volumes:
  lenguaraz-data:
```

- [ ] **Step 4: Build and run the container locally**

```bash
docker compose build
GEMINI_API_KEY=x ADMIN_TOKEN=dev docker compose run --rm --service-ports lenguaraz -fake &
sleep 3; curl -s localhost:8080/api/rooms; curl -sI localhost:8080/samples/en.wav | head -1; docker compose down
```
Expected: rooms JSON, `HTTP/1.1 200 OK` for the sample. (Extra args after the service name are appended to the ENTRYPOINT.)

- [ ] **Step 5: Write `README.md`**

````markdown
# Lenguaraz

**Open source real-time captions and translation for conferences.**
Live audio from each stage becomes subtitles in the original language and in
Spanish, English or Portuguese, for many sessions at once. Built for the
[Nerdearla](https://nerdear.la) 2026 Vibeathon.

> *Lenguaraz*: the interpreters who mediated between languages in the history
> of the Río de la Plata.

## What it does

- One **operator page per room** captures a microphone / line-in from the
  sound desk, or plays an audio file, and streams it to the server.
- Each room transcribes with Gemini's live transcription model
  (`gemini-3.5-transcribe-live`) and translates every finished sentence with a
  fast text model (`gemini-3.5-flash-lite`), keeping glossary terms intact.
- The **audience** opens `/`, picks a room and a language and reads live
  captions on their phone. The same page has a **projector** mode and a
  transparent **OBS overlay** mode.
- Transcripts are saved per room and can be downloaded as **VTT, SRT or TXT**.
- A **production panel** shows every room's state, audience, latency and errors.

## Quick start

Requirements: Go 1.26+ (or Docker) and a Gemini API key from
[Google AI Studio](https://aistudio.google.com/apikey).

```bash
git clone https://github.com/RchrdHndrcks/lenguaraz && cd lenguaraz
export GEMINI_API_KEY=...        # required
export ADMIN_TOKEN=change-me     # protects operator and admin pages
go run ./cmd/lenguaraz           # http://localhost:8080
```

Try it without a key (scripted captions): `go run ./cmd/lenguaraz -fake`.

With Docker: `GEMINI_API_KEY=... ADMIN_TOKEN=... docker compose up --build`.

### Try it with the bundled samples

1. Open `http://localhost:8080/operator/sala-a?token=change-me`, click
   **sample EN**, then **Transmitir**.
2. Open `http://localhost:8080/operator/sala-b?token=change-me`, click
   **sample ES**, then **Transmitir** — two sessions in parallel.
3. Open `http://localhost:8080/` and pick a room and a language.

To use a real talk: download its audio (for example with
`yt-dlp -x --audio-format m4a <youtube-url>`) and choose it with the file
picker in the operator page.

## Pages

| URL | Who | What |
|---|---|---|
| `/` | audience | rooms and languages |
| `/r/{room}?lang=es` | audience | captions on a phone (history, language switch, downloads) |
| `/r/{room}?lang=es&mode=screen` | stage screen | last 3 lines, huge type |
| `/r/{room}?lang=es&mode=overlay` | OBS / vMix | transparent background, 2 lines — add as a Browser Source |
| `/operator/{room}?token=…` | tech desk | audio source, level meter, live preview |
| `/admin?token=…` | production | status, audience, latency, errors, exports |
| `/export/{room}/{vtt,srt,txt}?lang=es` | anyone | full transcript |

## Configuration

Rooms live in `rooms.yaml`:

```yaml
rooms:
  - id: sala-a
    title: "Sala A — Keynotes"
    source: en            # language spoken on stage: en | es | pt
    targets: [es, pt]     # translations to produce
    glossary: [Nerdearla, Kubernetes, eBPF]
```

`glossary` terms bias the transcription (custom vocabulary) and are never
translated.

| Env / flag | Default | |
|---|---|---|
| `GEMINI_API_KEY` | — | required unless `-fake` |
| `ADMIN_TOKEN` | empty (open) | guards `/operator` streaming, `/ingest`, `/admin` |
| `ASR_MODEL` | `gemini-3.5-transcribe-live` | Live transcription model |
| `TRANSLATE_MODEL` | `gemini-3.5-flash-lite` | translation model |
| `-addr` | `:8080` | listen address |
| `-config` | `rooms.yaml` | rooms file |
| `-data` | `data` | transcript directory (JSONL per room) |
| `-fake` | off | scripted engines, no API calls |

## How it works

```
operator browser ──PCM 16 kHz / WebSocket──▶ room ──▶ Gemini Live transcription
                                               │            │ interim + final text
                                               │            ▼
                                               │      translate each sentence
                                               ▼            │ (one call per target language)
audience browsers ◀──── Server-Sent Events ─── hub ◀── store (JSONL)
```

- One goroutine pipeline per room; audio is billed once per room and every
  extra language is only a cheap text call.
- Live sessions are rotated before their 10-minute limit and reconnected with
  backoff; audio waits in the WebSocket meanwhile.
- Slow viewers are dropped instead of slowing a room down; their browser
  reconnects and replays the last 50 lines.

## Scaling to more rooms

A single instance handles many rooms: each room is one Live session plus a
handful of goroutines, and viewers are plain SSE connections. The limits you
will hit first are the Gemini API quotas (concurrent Live sessions, requests
per minute) — check them for your key and request increases for big events.

To go beyond one machine:

1. **Shard rooms across instances.** Run N copies with different
   `rooms.yaml` files and route `/r/{room}`, `/events/{room}`,
   `/ingest/{room}` to the instance that owns the room (a path-based rule in
   any reverse proxy). No shared state is needed.
2. **Scale viewers separately.** For very large audiences, put the SSE
   fan-out behind a shared bus (Redis Pub/Sub, NATS or Google Pub/Sub): rooms
   publish segments, stateless edge instances subscribe and serve viewers.
3. **Local models.** Transcription and translation sit behind two small Go
   interfaces (`asr.Engine`, `translate.Translator`), so a Gemma or Whisper
   backend can replace Gemini for fully offline events.

## Development

```bash
go test -race ./...
samples/make-samples.sh          # regenerate TTS samples (macOS + ffmpeg)
ffmpeg -loglevel error -i samples/en.wav -f s16le -ac 1 -ar 16000 - | \
  go run ./cmd/asr-smoke -lang en   # check the Live API from the terminal
```

## License

[Apache-2.0](LICENSE)
````

- [ ] **Step 6: Run the full test suite and commit**

```bash
go vet ./... && go test -race ./...
git add .gitignore .dockerignore Dockerfile docker-compose.yml README.md
git commit -m "Add Docker packaging and README"
```

- [ ] **Step 7: Open the PR**

Invoke the `create-pr` skill for branch `mvp` → `main`. Title: "Build the Lenguaraz MVP".

- [ ] **Step 8: Prepare the Mac Mini deployment**

Inspect the existing setup first (read-only):

```bash
ssh mimini 'ls ~/deployments; sed -n 1,200p ~/deployments/autodeploy/webhook-server.py | grep -n "compose\|git\|branch" ; ls ~/.cloudflared; cat ~/.cloudflared/config.yml 2>/dev/null; docker ps --format "{{.Names}} {{.Ports}}"'
```

From the output, confirm: which command the webhook runs on push (expected `git pull` + `docker compose up -d --build`), which branch it deploys, which host ports are taken, and how public hostnames map to ports in the tunnel config. Pick a free host port (e.g. `8095`) and a hostname (`lenguaraz.franconiz.com`); confirm both with the user before editing the tunnel config.

Then:

```bash
ssh mimini 'mkdir -p ~/deployments/lenguaraz && cd ~/deployments/lenguaraz && git clone https://github.com/RchrdHndrcks/lenguaraz code && cp code/rooms.yaml rooms.yaml'
ssh mimini 'cat > ~/deployments/lenguaraz/docker-compose.yml' <<'EOF'
services:
  lenguaraz:
    build: ./code
    ports:
      - "127.0.0.1:8095:8080"
    env_file: .env
    volumes:
      - ./rooms.yaml:/app/rooms.yaml:ro
      - lenguaraz-data:/data
    restart: unless-stopped

volumes:
  lenguaraz-data:
EOF
```

Create `~/deployments/lenguaraz/.env` on the Mini with `GEMINI_API_KEY` and `ADMIN_TOKEN` (ask the user for the key; never echo it into logs or commit it). Until the PR is merged, check out the branch there: `ssh mimini 'cd ~/deployments/lenguaraz/code && git checkout mvp'`.

- [ ] **Step 9: Expose, hook and start**

1. Add the ingress rule `lenguaraz.franconiz.com → http://localhost:8095` to the tunnel config (and `cloudflared tunnel route dns <tunnel> lenguaraz.franconiz.com`), then restart cloudflared the way the existing setup does it.
2. Add the GitHub webhook: `gh api repos/RchrdHndrcks/lenguaraz/hooks -f name=web -F active=true -f 'events[]=push' -f config[url]=https://webhook.franconiz.com -f config[content_type]=json` (add `config[secret]` if the webhook server uses one — check `webhook-server.py`).
3. Restart the webhook service: `ssh mimini 'launchctl stop com.autodeploy.webhook && launchctl start com.autodeploy.webhook'`.
4. Start: `ssh mimini 'cd ~/deployments/lenguaraz && docker compose up -d --build'`.

- [ ] **Step 10: Verify the public deployment**

```bash
curl -s https://lenguaraz.franconiz.com/healthz
curl -s https://lenguaraz.franconiz.com/api/rooms
curl -sN --max-time 5 https://lenguaraz.franconiz.com/events/sala-a | head -3
```
Expected: `ok`; rooms JSON; `event: status` arrives immediately (SSE is not buffered by the tunnel). Then repeat Task 10 Step 6 against the public URL from a phone for the viewer.

---

## After the plan (not code tasks)

- Record the 1–2 minute demo video with a real Nerdearla talk (operator page with the file picker, two rooms, phone + OBS overlay), and generate its English subtitles with Lenguaraz itself (`/export/{room}/srt?lang=en`) — the rules' pro-tip.
- Submit the repo URL and the YouTube link before 2026-09-25 15:00 UTC.
