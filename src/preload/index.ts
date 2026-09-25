import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('bau', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  chooseWorkspace: () => ipcRenderer.invoke('workspace:choose'),
  scanWorkspace: (maxFiles?: number) => ipcRenderer.invoke('workspace:scan', maxFiles),
  runProjectCheck: (check: 'build' | 'test' | 'lint' | 'typecheck') => ipcRenderer.invoke('code:run-check', check),
  listProposals: () => ipcRenderer.invoke('code:proposals'),
  applyProposal: (id: string) => ipcRenderer.invoke('code:apply-proposal', id),
  discardProposal: (id: string) => ipcRenderer.invoke('code:discard-proposal', id),
  loadHistory: () => ipcRenderer.invoke('history:load'),
  saveHistory: (messages: unknown[]) => ipcRenderer.invoke('history:save', messages),
  ask: (payload: { messages: { role: 'user' | 'assistant'; content: string }[]; mode: 'chat' | 'code' }) =>
    ipcRenderer.invoke('ai:ask', payload),
  transcribe: (bytes: ArrayBuffer, extension = 'webm') => ipcRenderer.invoke('audio:transcribe', { bytes, extension }),
  speak: (text: string) => ipcRenderer.invoke('audio:speak', text),
  summarizeMeeting: (transcript: string) => ipcRenderer.invoke('meeting:summarize', transcript),
  startMeeting: (payload: { title?: string; capture: { microphone: boolean; systemAudio: boolean } }) =>
    ipcRenderer.invoke('meeting:start', payload),
  saveMeetingChunk: (payload: {
    id: string
    bytes: ArrayBuffer
    extension?: string
    chunkIndex: number
  }) => ipcRenderer.invoke('meeting:save-chunk', payload),
  transcribeSavedMeetingChunk: (payload: {
    id: string
    extension?: string
    chunkIndex: number
    offsetMs: number
  }) => ipcRenderer.invoke('meeting:transcribe-saved-chunk', payload),
  finishMeeting: (id: string) => ipcRenderer.invoke('meeting:finish', id),
  listMeetings: (query = '') => ipcRenderer.invoke('meeting:list', query),
  getMeeting: (id: string) => ipcRenderer.invoke('meeting:get', id),
  onVoiceToggle: (callback: () => void) => {
    const listener = () => callback()
    ipcRenderer.on('voice:toggle', listener)
    return () => ipcRenderer.removeListener('voice:toggle', listener)
  },
})
