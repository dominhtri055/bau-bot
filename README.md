# Bâu Bot v0.2

Vietnamese-first Windows desktop AI assistant built with Electron + React + TypeScript.

## V0.2 capabilities

### Voice + assistant
- Chat primarily in Vietnamese with a configurable OpenAI model.
- `Ctrl + Space` toggles microphone recording; speech is transcribed with Vietnamese language hint.
- Optional AI voice replies.
- Safe Windows app launcher for VS Code, File Explorer, Notepad, Calculator, Windows Terminal and Edge.
- Local chat history stored in Electron `userData`.

### Coding Agent
- Pick an active project with a native Windows folder picker.
- Scan the project while ignoring `.git`, `node_modules`, build output, `.next`, coverage, etc.
- Search source text/symbols and read relevant files.
- Detect `package.json`, package manager, scripts and dependencies.
- Run only existing `build`, `test`, `lint` or `typecheck` scripts; no arbitrary shell command tool is exposed to the model.
- Generate file edits as **pending patches** instead of writing immediately.
- Show the proposed diff in the Patch Approval panel.
- `Apply patch` verifies the file has not changed, creates a local backup, then writes the change.
- `Discard` throws the proposal away without touching the source file.
- Filesystem checks reject lexical path traversal and symlink/junction escape outside the selected workspace.

### Meeting Assistant
- Paste a transcript and generate summary, decisions, action items, deadlines and open questions.
- While Meeting mode is open, `Ctrl + Space` can append microphone transcription to the meeting transcript.
- Windows system-audio capture and speaker diarization are planned for v0.3.

## Security model

- `OPENAI_API_KEY` is only read in Electron main; it is never exposed through the preload bridge.
- Renderer uses `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`.
- No arbitrary shell execution is available to the AI.
- Project commands are limited to known package scripts: build/test/lint/typecheck.
- AI-generated edits are approval-gated and restricted to the selected project.
- Existing files are backed up before an approved patch is written.
- Delete, package install, git push, registry changes, shutdown and unrestricted mouse/keyboard automation are not implemented.

## Windows setup

1. Install Node.js 22+ and Git.
2. Open PowerShell in the project folder.
3. Install dependencies:

```powershell
npm install
```

4. Create `.env`:

```powershell
Copy-Item .env.example .env
notepad .env
```

5. Add your OpenAI API key. `BAU_WORKSPACE_ROOT` is optional now because the Coding UI can choose a project folder:

```env
OPENAI_API_KEY=sk-...
BAU_MODEL=gpt-5.6-sol
BAU_REASONING_EFFORT=medium
BAU_WORKSPACE_ROOT=C:\Users\YOUR_NAME\source\repos\tri-ai-assistant
```

6. Start development mode:

```powershell
npm run dev
```

## Try Coding Agent

1. Open **Coding**.
2. Click **Chọn project…** and pick a project folder.
3. Ask:
   - `Scan project này và giải thích architecture.`
   - `Chạy build rồi tìm nguyên nhân lỗi.`
   - `Tìm component login và giải thích flow.`
   - `Sửa lỗi build này cho tôi.`
4. When Bâu Bot wants to edit source, inspect the diff in **Patch Approval**.
5. Click **Apply patch** or **Discard**.
6. Ask Bâu Bot to run build/test again to verify.

## Build Windows installer

```powershell
npm run dist:win
```

Installer output is written to `release/`.

## Roadmap

### v0.3 Meeting Agent
- Capture microphone + Windows system audio.
- Long-session chunked transcription.
- Speaker diarization.
- Save meetings locally and search meeting history.

### v0.4 Desktop Agent
- Screenshot understanding.
- Permission-gated mouse/keyboard automation.
- Confirmation UI for destructive/external actions.

### v0.5 Memory + integrations
- Structured long-term memory.
- Project/meeting retrieval.
- Optional calendar/email integrations.
