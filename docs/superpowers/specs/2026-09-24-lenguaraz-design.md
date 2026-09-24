# Lenguaraz — Design

Date: 2026-09-24
Context: Nerdearla 2026 Vibeathon (deadline 2026-09-25 15:00 UTC)

## Goal

Open source, self-hostable real-time captioning for conferences. Live audio
from each stage produces subtitles in the original language and translated
(EN→ES required, ES→EN and PT optional), for several sessions in parallel.
The audience picks a session and a language on a web page.

Non-goals for the vibeathon: replacing human interpreters, multi-instance
deployment, user accounts/roles, a working local (Gemma) backend.

## Hard requirements (from the vibeathon rules)

1. Live audio from at least one source: microphone, audio file, or stream.
   Test audio files ship in the repo with an easy way to play them in.
2. Real-time transcription of the original language (ES or EN).
3. Real-time translation EN→ES.
4. Subtitles shown somewhere (web page).
5. At least two sessions processed simultaneously; README explains scaling.
6. OSI license (Apache-2.0), README with setup and required credentials.
7. All code written during the vibeathon.

## Architecture

Single Go binary (`cmd/lenguaraz`) with the frontend (plain HTML/JS/CSS,
no build step) embedded via `embed.FS`. Deployed with docker compose on the
Mac Mini behind Cloudflare Tunnel.

```
 Operator browser (1 per room)              Audience (N per room)
 mic / line-in / audio file                  /r/{room}?lang=es&mode=mobile|screen|overlay
        │ AudioWorklet → PCM16 mono 16 kHz              ▲
        ▼ WebSocket /ingest/{room}?token=…               │ SSE /events/{room}
 ┌───────────────────────── lenguaraz ───────────────────────────────┐
 │ room.Hub (one goroutine per room)                                   │
 │   ├─ asr.Transcriber   → Gemini Live `gemini-3.5-transcribe-live`   │
 │   ├─ translate.Translator → Gemini text model + room glossary       │
 │   ├─ fan-out to SSE subscribers + in-memory ring buffer             │
 │   └─ store: data/transcripts/{room}.jsonl (append-only)             │
 │ /admin: room status, latency, errors, export links                  │
 └─────────────────────────────────────────────────────────────────────┘
```

### Why this pipeline (hybrid)

- Transcription uses the dedicated Live transcription model
  `gemini-3.5-transcribe-live`: streaming PCM in, `interim_input_transcription`
  (partials) and `input_transcription` (finals) out, `custom_vocabulary`
  (up to 1,000 terms) for the glossary, `language_codes` to pin the source
  language. It does not generate a conversational reply, so no wasted output
  tokens.
- Translation is a separate text-to-text call per final segment. Rejected
  alternatives: conversational Live models only output AUDIO (text only via
  output transcription, and they tend to answer rather than translate);
  `gemini-3.5-live-translate-preview` outputs translated *audio* with one
  target language per session, so each extra language costs another audio
  session. Text translation makes each extra target language cheap and lets us
  inject the glossary into the prompt.
- Cost: audio is billed once per room; translation cost scales with text.

## Components

| Package | Responsibility | Interface |
|---|---|---|
| `config` | Load `rooms.yaml` + env | `Load(path) (Config, error)` |
| `asr` | Live session lifecycle, reconnect before/after the ~10 min session limit | `Transcriber.Run(ctx, audio <-chan []byte) <-chan Event` where `Event{Kind: Interim\|Final\|Error, Text}` |
| `translate` | Text translation with glossary | `Translator.Translate(ctx, text, src, dst string, glossary []string) (string, error)` |
| `room` | Per-room state, pipeline wiring, subscribers, ring buffer, metrics | `Hub.Subscribe() (<-chan Msg, cancel)`, `Hub.Ingest(pcm []byte)` |
| `store` | Append/read JSONL segments per room | `Append(Segment)`, `Load(room) ([]Segment, error)` |
| `export` | VTT / SRT / TXT from segments | pure functions |
| `web` | HTTP handlers: home, viewer, operator, admin, ingest WS, SSE, export | — |

`asr` and `translate` each have a fake implementation (`--fake` flag) that
emits scripted text, so tests and local demos run without an API key. The
interfaces are the documented seam for a future local backend (Gemma/Whisper).

Go SDK note: if `google.golang.org/genai` does not expose the transcription
model's fields (`interim_input_transcription`, `custom_vocabulary`, `mode`),
`asr` talks to the Live WebSocket endpoint directly with its JSON protocol.
Decide during planning after checking the SDK.

## Data model

`rooms.yaml`:

```yaml
rooms:
  - id: sala-a
    title: "Keynote — Sala A"
    source: en            # en | es (pinned; auto-detect is a fallback)
    targets: [es]         # en rooms: [es] (+pt); es rooms: [en] (+pt)
    glossary: [Kubernetes, Nerdearla, eBPF]
```

Segment (JSONL line and SSE payload for finals):

```json
{"id": 42, "room": "sala-a", "t0": 812.4, "t1": 816.9,
 "lang": "en", "text": "…", "translations": {"es": "…"},
 "error": ""}
```

`t0`/`t1` are seconds since the room's session started (from bytes of
audio received), used for VTT/SRT timing.

SSE events: `interim` (`{text}`, original language only), `final`
(Segment), `status` (`{live: bool}`). On connect the server replays the
ring buffer (last 50 finals, rehydrated from JSONL on restart).

## Frontend

- `/` — list of rooms with live status; pick room + language.
- `/r/{room}?lang=xx&mode=mobile|screen|overlay` — one page, three CSS modes:
  - `mobile`: scrolling history, big font, dark, language switcher.
  - `screen`: fullscreen, last 2–3 lines, huge type, for a projector.
  - `overlay`: transparent background, bottom-anchored 2 lines, for OBS
    Browser Source.
  Original-language view shows the grey live interim line; translated views
  show finals only.
- `/operator/{room}` (token) — input device selector (mic/line-in) or file
  picker (plays the file and captures via `MediaElementSource`), level meter,
  connection status, start/stop. AudioWorklet downsamples to 16 kHz PCM16 and
  sends ~100 ms chunks.
- `/admin` (token) — per room: live/idle, operator connected, viewers,
  last-segment age, avg latency, error count, export links.

## Error handling

- Live session drop or session-limit expiry: reconnect with backoff; buffer up
  to ~5 s of audio during reconnect; emit `status`.
- Translation failure: publish segment with original text and `error` set;
  viewers of the target language see the original with a marker.
- Slow SSE subscriber: buffered channel per subscriber; if full, drop the
  subscriber (the browser's EventSource reconnects and replays the buffer).
  The hub never blocks.
- Operator disconnect: room goes idle; Live session closed after 30 s idle.

## Security

`ADMIN_TOKEN` env guards `/operator/*`, `/ingest/*`, `/admin`. Audience views
and exports are public. `GEMINI_API_KEY` stays server-side only.

## Testing

- Unit: export formats, store round-trip, hub fan-out (incl. slow subscriber
  drop), segment timing, config parsing.
- Pipeline: room with fake transcriber/translator → assert SSE-level messages.
- Manual/E2E: two operator tabs playing two sample files into two rooms,
  viewers in all three modes; recorded as the demo video.
- `samples/`: short EN and ES clips with a license compatible with
  redistribution.

## Scope for the deadline

- Must: ingest (mic + file), Live ASR, EN↔ES translation, three viewer modes,
  2+ parallel rooms, README (setup, credentials, how to scale), Apache-2.0,
  samples, deploy on the Mini.
- Should: VTT/SRT/TXT export, glossary (custom vocabulary + translation
  prompt), `/admin` panel, Portuguese target.
- Documented only: scaling out to multiple instances (rooms sharded by id
  across instances, or a shared bus such as Redis/PubSub for fan-out), local
  Gemma backend behind the same interfaces.

## Deployment

`~/deployments/lenguaraz/` on the Mac Mini with `docker-compose.yml` and the
repo cloned as `code/`; GitHub webhook to the autodeploy server; a new public
hostname in the Cloudflare Tunnel config (e.g. `lenguaraz.franconiz.com`)
pointing at the container port. `data/` mounted as a volume for transcripts.
