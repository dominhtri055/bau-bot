# Bâu Bot v0.3

Vietnamese-first Windows desktop AI assistant built with Electron + React + TypeScript.

## Current capabilities

### Voice + assistant
- Chat primarily in Vietnamese with a configurable OpenAI model.
- `Ctrl + Space` toggles microphone recording in Chat/Coding.
- Speech-to-text uses `gpt-4o-transcribe` by default.
- Optional AI voice replies.
- Safe Windows app launcher for VS Code, File Explorer, Notepad, Calculator, Windows Terminal and Edge.
- Local chat history stored in Electron `userData`.

### Coding Agent
- Pick an active project with a native Windows folder picker.
- Scan the project while ignoring `.git`, `node_modules`, build output, `.next`, coverage, etc.
- Search source text/symbols and read relevant files.
- Detect `package.json`, package manager, scripts and dependencies.
- Run only existing `build`, `test`, `lint` or `typecheck` scripts.
- Generate file edits as pending patches instead of writing immediately.
- Show proposed diffs in the Patch Approval panel.
- Apply verifies the original content, creates a local backup, then writes the change.
- Filesystem checks reject path traversal and symlink/junction escape outside the selected workspace.

### Meeting Agent v0.3
- Record microphone and Windows system audio together.
- Uses Electron Windows loopback capture for app/system sound.
- Records in independent ~2 minute audio chunks so long meetings do not live entirely in RAM.
- Each chunk is saved locally before transcription.
- Uses `gpt-4o-transcribe-diarize` for timestamped speaker-labeled transcript.
- Falls back to normal transcription if diarization is unavailable.
- Automatically generates:
  - summary
  - decisions
  - action items
  - deadlines
  - open questions
- Stores meeting transcript, summary, audio chunks and metadata locally.
- Search meeting history by title, transcript or summary.
- Open an old meeting and review its transcript/summary.
- In Meeting mode, `Ctrl + Space` starts/stops the full meeting recorder.

> Note: diarization is run per audio chunk. Speaker labels such as A/B are reliable within that chunk, but the same letter is not guaranteed to identify the same person across separate chunks unless known-speaker references are added in a future version.

## Security model

- `OPENAI_API_KEY` is only read in Electron main; it is never exposed through the preload bridge.
- Renderer uses `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`.
- No arbitrary shell execution is available to the AI.
- Project commands are limited to known package scripts: build/test/lint/typecheck.
- AI-generated edits are approval-gated and restricted to the selected project.
- Existing files are backed up before an approved patch is written.
- Meeting audio stays under Electron `userData/meetings/<meeting-id>/audio`.
- Audio is sent to the configured transcription API only when its chunk is processed.
- Delete, package install, git push, registry changes, shutdown and unrestricted mouse/keyboard automation are not implemented.

## Windows setup

1. Install Node.js 22+ and Git.
2. Clone the repository:

```powershell
git clone https://github.com/dominhtri055/bau-bot.git
cd bau-bot
```

3. Install dependencies:

```powershell
npm install
```

4. Create `.env`:

```powershell
Copy-Item .env.example .env
notepad .env
```

5. Add your API key:

```env
OPENAI_API_KEY=sk-...
BAU_MODEL=gpt-5.6-sol
BAU_REASONING_EFFORT=medium

BAU_TRANSCRIBE_MODEL=gpt-4o-transcribe
BAU_TTS_MODEL=gpt-4o-mini-tts
BAU_TTS_VOICE=coral

BAU_MEETING_TRANSCRIBE_MODEL=gpt-4o-transcribe-diarize
BAU_MEETING_LANGUAGE=vi
```

6. Start:

```powershell
npm run dev
```

## Try Meeting Agent

1. Open **Meeting**.
2. Enter a meeting name if desired.
3. Click **Start meeting**.
4. Allow microphone access.
5. Bâu Bot requests Windows display/system-audio capture and mixes it with your microphone.
6. Transcript appears after each audio chunk is processed.
7. Click **Stop & summarize**.
8. Wait for the final chunk and summary to finish.
9. The meeting appears in **Local History**.

If Windows/system capture is unavailable or denied, recording continues microphone-only.

## Build Windows installer

```powershell
npm run dist:win
```

Installer output is written to `release/`.

## Local data

Typical meeting data structure under Electron user data:

```text
meetings/
└── <meeting-id>/
    ├── meeting.json
    └── audio/
        ├── chunk-0000.webm
        ├── chunk-0001.webm
        └── ...
```

## Roadmap

### v0.4 Desktop Agent
- Screenshot understanding.
- Permission-gated mouse/keyboard automation.
- Confirmation UI for destructive/external actions.
- Verify actions after execution instead of assuming success.

### v0.5 Memory + integrations
- Structured long-term memory.
- Project/meeting retrieval in normal chat.
- Ask questions such as “meeting hôm qua tôi được giao việc gì?”
- Optional calendar/email integrations.

### Later
- Known-speaker voice references to keep names consistent across meeting chunks.
- Export meeting notes to Markdown/PDF/Google Docs.
- Optional local/offline transcription path.
