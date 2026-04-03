# Jarvis — Voice-Controlled AI Agent Manager for cmux

## What Is This?

A voice layer on top of cmux that lets you manage multiple Claude Code / Codex sessions entirely by voice. No keyboard, no mouse. Jarvis speaks when agents finish tasks, listens for your commands, and routes them to the right session.

## The Vision

```
Claude Code finishes a task in pane 2
  → Jarvis SPEAKS: "Claude finished the auth module. Tests passing."
You SPEAK: "Tell it to build the login page next"
  → Jarvis transcribes → sends to pane 2 via cmux socket
  → Claude Code starts working. You walk away.
  → Jarvis tells you when it's done.
```

Zero keyboard. Zero mouse. You're Tony Stark talking to your agents.

## Architecture

```
┌─────────────────────────────────────┐
│              cmux                    │
│  Pane 1: Claude Code (session A)    │
│  Pane 2: Claude Code (session B)    │
│  Pane 3: Codex (session C)          │
│  Pane 4: JARVIS DAEMON              │
│  Sidebar: agent status from Jarvis  │
└────────────┬────────────────────────┘
             │ Unix socket /tmp/cmux.sock
┌────────────▼────────────────────────┐
│        JARVIS (Bun daemon)          │
│                                     │
│  Event Listener → SPEAK completions │
│  Voice Loop → HEAR commands         │
│  Router → SEND to right pane        │
│  Sidebar → SHOW agent status        │
└─────────────────────────────────────┘
```

Three jobs:
1. **Listen to cmux** — poll notifications via socket, speak them aloud
2. **Listen to you** — always-on mic via whisper.cpp, transcribe locally
3. **Route commands** — parse "tell session 2 to X" → surface.send_text

## cmux Socket API (Key Methods We Use)

All via JSON-RPC over Unix socket at `/tmp/cmux.sock`:

| Method | What We Use It For |
|--------|-------------------|
| `notification.list` | Detect task completions |
| `notification.clear` | Mark as handled |
| `workspace.list` | Know which sessions exist |
| `surface.list` | Know which panes exist |
| `surface.send_text` | Send commands to Claude/Codex sessions |
| `surface.send_key` | Send Enter after text |
| `set_status` | Update sidebar status pills |
| `log` | Add entries to sidebar log |
| `system.identify` | Know our own context |

Message format:
```json
{"id":"req-1","method":"workspace.list","params":{}}
```

## Tech Stack

| Component | Technology | Why |
|-----------|-----------|-----|
| Runtime | Bun + TypeScript | Fast, built-in SQLite if needed later |
| STT | whisper.cpp (local) | Fast (~1s), private, no API key |
| TTS | macOS `say` | Zero deps, instant |
| IPC | Unix socket (cmux) | Already exists, JSON-RPC |
| Audio | ffmpeg | Already installed, mic access works |

## Lessons from Previous Project (assistant/)

We scrapped an earlier attempt at building a Jarvis-like assistant. Key learnings:

### DO
- **Build lean.** One file that does something impressive > 30 files of types.
- **Latency is the product.** If it's slow, nothing else matters.
- **Use existing infrastructure.** cmux already has notifications, socket API, sidebar. Don't rebuild.
- **Get to the wow moment fast.** Prototype first, refactor later.
- **Test what matters.** Integration tests > unit tests for type definitions.

### DON'T
- **Don't over-engineer.** No safety gate with 5 trust levels before you can send a message.
- **Don't PR every feature.** Ship fast during prototyping, formalize later.
- **Don't wrap CLIs per-message.** `claude -p` has 5-6s startup overhead. Use persistent processes or sockets.
- **Don't build frameworks.** Build products. Types, Zod schemas, and audit logs don't matter if the thing feels dead.
- **Don't build voice on macOS SFSpeechRecognizer in CLI context.** It crashes (SIGABRT) due to TCC permissions. Use whisper.cpp or ffmpeg+transcription instead.

### Latency Targets
- Voice transcription: <2s (whisper.cpp local)
- Speaking a notification: <500ms (macOS say is instant)
- Sending text to a pane: <100ms (socket is local)
- Total voice-to-action loop: <3s

## Project Structure (Target)

```
jarvis-cmux-plugin/
├── CLAUDE.md              # This file
├── package.json
├── tsconfig.json
├── cmux.json              # Custom command: launches Jarvis workspace
├── src/
│   ├── index.ts           # Entry: wire everything, start daemon
│   ├── cmux-client.ts     # Unix socket JSON-RPC client
│   ├── event-listener.ts  # Poll notifications, detect completions
│   ├── voice-loop.ts      # Record mic → whisper.cpp → text
│   ├── speaker.ts         # macOS say wrapper
│   └── router.ts          # Parse intent → route to correct pane
└── tests/
    └── (integration tests that actually talk to cmux socket)
```

~360 lines total. Six files. That's it.

## Autonomous Development Strategy (Zero Human-in-the-Loop)

This project should be buildable by Claude with almost zero human intervention. The user says "build this feature" and it arrives working. Here's how:

### Self-Validation Loop

Every change follows this cycle — Claude does ALL of it, not the human:

```
Write code → Run it → Does it work? → No → Read error → Fix → Run again
                          ↓ Yes
                     Commit & move on
```

### How Claude Validates Its Own Work

1. **TypeScript strict mode** — compiler catches type errors without running anything
2. **Integration tests against real cmux socket** — if cmux is running, test against it. If not, test the client serialization/parsing in isolation
3. **Audio tests** — spawn `say` and verify it doesn't crash. Spawn ffmpeg recording for 1s and verify a WAV file appears
4. **End-to-end smoke test** — `bun run dev` should start without errors. A test script sends a fake notification via cmux socket and verifies Jarvis speaks it

### What to Test (and What NOT to)

**DO test:**
- cmux socket client sends valid JSON-RPC and parses responses
- Voice transcription produces text from a known audio file
- Router correctly maps "tell session 2 to X" → right surface_id
- Daemon starts, connects to socket, doesn't crash

**DON'T test:**
- Type definitions
- Config schemas
- Utility functions with obvious behavior
- Anything that's just plumbing

### Quality Gate

```bash
bun run check   # typecheck + lint + test + build (all must pass)
```

But ONLY run this before committing. During development, just run the code and see if it works.

### Build Order (Critical Path)

Build in this exact order. Each step must work before moving to the next:

```
Step 1: cmux socket client
        → Can send JSON-RPC, receive response
        → Validate: call system.ping, get pong

Step 2: Event listener
        → Polls notification.list every 2s
        → Detects new notifications
        → Validate: manually create notification via cmux CLI,
          verify daemon picks it up

Step 3: Speaker
        → macOS say wrapper
        → Validate: speaks "hello world" audibly

Step 4: Wire steps 1-3 together
        → Notification arrives → Jarvis speaks it
        → THIS IS THE FIRST WOW MOMENT. Demo it here.

Step 5: Voice recording
        → ffmpeg records from mic for N seconds
        → Saves WAV to /tmp
        → Validate: file exists, has audio content

Step 6: Voice transcription
        → whisper.cpp transcribes WAV → text
        → Validate: known phrase produces correct text

Step 7: Voice command router
        → Parse "tell session 2 to build the login page"
        → Map to surface.send_text on the right pane
        → Validate: text appears in target pane

Step 8: Wire steps 5-7 into voice loop
        → Continuous: record → transcribe → route → repeat
        → THIS IS THE FULL JARVIS MOMENT.

Step 9: Sidebar status
        → set_status pills showing which agents are busy/idle
        → log entries for recent completions
        → Polish pass.
```

### Error Recovery

If something doesn't work:
1. **Read the actual error.** Don't guess.
2. **Check if cmux is running.** Socket won't exist if it's not.
3. **Check if whisper.cpp is installed.** `which whisper-cpp` or `which whisper`.
4. **Check ffmpeg mic access.** `ffmpeg -f avfoundation -i ":0" -t 1 -y /tmp/test.wav` — if this fails, mic permissions are the issue.
5. **Don't add abstractions to work around errors.** Fix the root cause.

### What the Human Does

The human's only job is:
1. Say what feature they want
2. Grant macOS permissions if prompted (mic, accessibility)
3. Say "it works" or "it doesn't work, I see X"

Everything else — writing code, running tests, fixing bugs, committing — is Claude's job.

## Development Rules

- **No commits until something works end-to-end.** Get the demo working first.
- **Test against real cmux.** No mocking the socket. If cmux isn't running, skip the test.
- **Prioritize feel over correctness.** Fast and slightly wrong > slow and perfect.
- **One `bun run dev` command to start everything.**

## Commands

```bash
bun install              # Install deps
bun run dev              # Start Jarvis daemon
bun run build            # Build for distribution
```

## cmux.json (Custom Command)

This file goes in the project root. It adds a "Jarvis" command to cmux's command palette:

```json
{
  "commands": [
    {
      "name": "Jarvis",
      "description": "Launch voice-controlled AI agent manager",
      "keywords": ["voice", "jarvis", "agent"],
      "workspace": {
        "name": "Jarvis",
        "layout": {
          "direction": "horizontal",
          "split": 0.75,
          "children": [
            { "surfaces": [{ "type": "terminal", "name": "Claude Code", "focus": true }] },
            { "surfaces": [{ "type": "terminal", "name": "Jarvis", "command": "cd ~/code/jarvis-cmux-plugin && bun run dev" }] }
          ]
        }
      }
    }
  ]
}
```

## Prerequisites

- macOS with cmux installed
- Bun runtime (`curl -fsSL https://bun.sh/install | bash`)
- whisper.cpp (`brew install whisper-cpp`)
- ffmpeg (`brew install ffmpeg`) — already installed
- Claude Code CLI — already installed
