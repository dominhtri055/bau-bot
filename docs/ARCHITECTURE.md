# Bâu Bot architecture — v0.2

## Trust boundaries

```text
React renderer (untrusted UI)
        |
        | narrow IPC bridge
        v
Electron preload (contextBridge)
        |
        v
Electron main (trusted)
   |       |        |          |
   |       |        |          +-- Local history / patch backups
   |       |        +------------- Coding capability layer
   |       +---------------------- Windows tools (allowlist)
   +------------------------------ OpenAI API
```

The API key never crosses into the renderer.

## Agent loop

1. Renderer sends recent conversation messages to Electron main.
2. Main calls the Responses API with mode-specific tools.
3. Tool requests are validated and executed in main.
4. Tool output is returned to the model.
5. The model either calls another tool or produces the final answer.
6. In Coding mode, proposed edits become pending patch objects; they are not written automatically.

## Coding workflow

```text
Select project
   ↓
project_overview / scan_workspace
   ↓
search_workspace / read_text_file
   ↓
run_project_check (optional)
   ↓
AI diagnosis
   ↓
propose_file_edit
   ↓
Patch Approval UI
   ├── Discard → no filesystem change
   └── Apply   → verify old content → backup → write
                                      ↓
                               run check again
```

## Permission tiers

### Tier 1 — automatic / low risk
- Open allowlisted Windows apps.
- Open a folder.
- Read/search/scan selected project.
- Inspect package metadata.

### Tier 2 — constrained + user-visible
- Run an existing package `build`, `test`, `lint` or `typecheck` script.
- Generate code changes as pending patches.
- Apply a patch only after the user presses Apply.

### Tier 3 — not implemented
- Delete files.
- Install dependencies.
- Arbitrary PowerShell/cmd execution.
- Git push.
- Registry/system settings.
- Mouse/keyboard actions that submit forms or perform external side effects.

## Filesystem containment

Bâu Bot performs two checks:

1. **Lexical containment** rejects paths containing traversal outside the selected root.
2. **Canonical containment** resolves the real path and rejects symlink/junction escapes outside the selected root.

For a new file, the canonical parent directory must already be inside the workspace.

## Voice pipeline

```text
Ctrl+Space
 -> MediaRecorder
 -> audio bytes over IPC
 -> transcription with Vietnamese hint
 -> assistant/coding agent
 -> optional TTS
```

In Meeting mode, microphone transcription is appended to the transcript instead of being sent as a chat request.
