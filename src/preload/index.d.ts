export {}

type HistoryMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string
}

type EditProposal = {
  id: string
  path: string
  summary: string
  createdAt: string
  diff: string
}

type CheckResult = {
  ok: boolean
  error?: string
  exitCode?: number | null
  timedOut?: boolean
  stdout?: string
  stderr?: string
  durationMs?: number
  command?: string
  availableScripts?: string[]
}

declare global {
  interface Window {
    bau: {
      getConfig: () => Promise<{ hasApiKey: boolean; model: string; workspaceRoot: string }>
      chooseWorkspace: () => Promise<{ workspaceRoot: string; scan: unknown } | null>
      scanWorkspace: (maxFiles?: number) => Promise<{ root: string; files: { path: string; size: number }[]; truncated: boolean }>
      runProjectCheck: (check: 'build' | 'test' | 'lint' | 'typecheck') => Promise<CheckResult>
      listProposals: () => Promise<EditProposal[]>
      applyProposal: (id: string) => Promise<{ ok: boolean; path: string; backupPath: string | null }>
      discardProposal: (id: string) => Promise<boolean>
      loadHistory: () => Promise<HistoryMessage[]>
      saveHistory: (messages: HistoryMessage[]) => Promise<void>
      ask: (payload: { messages: { role: 'user' | 'assistant'; content: string }[]; mode: 'chat' | 'code' }) => Promise<string>
      transcribe: (bytes: ArrayBuffer, extension?: string) => Promise<string>
      speak: (text: string) => Promise<string>
      summarizeMeeting: (transcript: string) => Promise<string>
      onVoiceToggle: (callback: () => void) => () => void
    }
  }
}
