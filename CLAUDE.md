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
