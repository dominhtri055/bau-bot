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

type MeetingSegment = {
  id: string
  speaker: string
  start: number
  end: number
  text: string
  chunkIndex: number
}

type StoredMeeting = {
  id: string
  title: string
  startedAt: string
  endedAt: string | null
  durationMs: number | null
  status: 'recording' | 'completed'
  chunkCount: number
  transcript: string
  summary: string
  segments: MeetingSegment[]
  capture: {
    microphone: boolean
    systemAudio: boolean
  }
}

type MeetingListItem = {
  id: string
  title: string
  startedAt: string
  endedAt: string | null
  durationMs: number | null
  status: 'recording' | 'completed'
  chunkCount: number
  transcriptPreview: string
  summaryPreview: string
}

declare global {
  interface Window {
    bau: {
      getConfig: () => Promise<{
        hasApiKey: boolean
        model: string
        workspaceRoot: string
        meetingTranscribeModel: string
      }>
      chooseWorkspace: () => Promise<{ workspaceRoot: string; scan: unknown } | null>
      scanWorkspace: (maxFiles?: number) => Promise<{
        root: string
        files: { path: string; size: number }[]
        truncated: boolean
      }>
      runProjectCheck: (check: 'build' | 'test' | 'lint' | 'typecheck') => Promise<CheckResult>
      listProposals: () => Promise<EditProposal[]>
      applyProposal: (id: string) => Promise<{ ok: boolean; path: string; backupPath: string | null }>
      discardProposal: (id: string) => Promise<boolean>
      loadHistory: () => Promise<HistoryMessage[]>
      saveHistory: (messages: HistoryMessage[]) => Promise<void>
      ask: (payload: {
        messages: { role: 'user' | 'assistant'; content: string }[]
        mode: 'chat' | 'code'
      }) => Promise<string>
      transcribe: (bytes: ArrayBuffer, extension?: string) => Promise<string>
      speak: (text: string) => Promise<string>
      summarizeMeeting: (transcript: string) => Promise<string>
      startMeeting: (payload: {
        title?: string
        capture: { microphone: boolean; systemAudio: boolean }
      }) => Promise<StoredMeeting>
      saveMeetingChunk: (payload: {
        id: string
        bytes: ArrayBuffer
        extension?: string
        chunkIndex: number
      }) => Promise<{ ok: boolean }>
      transcribeSavedMeetingChunk: (payload: {
        id: string
        extension?: string
        chunkIndex: number
        offsetMs: number
      }) => Promise<{
        diarized: boolean
        fallbackReason?: string
        transcript: string
        segments: MeetingSegment[]
      }>
      finishMeeting: (id: string) => Promise<StoredMeeting>
      listMeetings: (query?: string) => Promise<MeetingListItem[]>
      getMeeting: (id: string) => Promise<StoredMeeting>
      onVoiceToggle: (callback: () => void) => () => void
    }
  }
}
