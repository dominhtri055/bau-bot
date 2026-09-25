import { app } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

export type MeetingSegment = {
  id: string
  speaker: string
  start: number
  end: number
  text: string
  chunkIndex: number
}

export type StoredMeeting = {
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

const meetingsRoot = () => path.join(app.getPath('userData'), 'meetings')

function meetingDir(id: string) {
  if (!/^[a-f0-9-]{20,}$/i.test(id)) throw new Error('Meeting id không hợp lệ.')
  return path.join(meetingsRoot(), id)
}

function meetingFile(id: string) {
  return path.join(meetingDir(id), 'meeting.json')
}

function safeExtension(extension: string) {
  const normalized = extension.toLowerCase().replace(/[^a-z0-9]/g, '')
  return ['webm', 'ogg', 'wav', 'mp3', 'm4a'].includes(normalized) ? normalized : 'webm'
}

function timestamp(seconds: number) {
  const whole = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(whole / 3600)
  const minutes = Math.floor((whole % 3600) / 60)
  const secs = whole % 60
  return [hours, minutes, secs].map((part) => String(part).padStart(2, '0')).join(':')
}

function rebuildTranscript(segments: MeetingSegment[]) {
  return [...segments]
    .sort((a, b) => a.start - b.start)
    .map((segment) => `[${timestamp(segment.start)}] Speaker ${segment.speaker}: ${segment.text.trim()}`)
    .filter(Boolean)
    .join('\n')
}

async function writeMeeting(meeting: StoredMeeting) {
  const dir = meetingDir(meeting.id)
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(meetingFile(meeting.id), JSON.stringify(meeting, null, 2), 'utf8')
  return meeting
}

export async function startStoredMeeting(
  title?: string,
  capture: StoredMeeting['capture'] = { microphone: true, systemAudio: true },
) {
  const id = crypto.randomUUID()
  const meeting: StoredMeeting = {
    id,
    title: title?.trim() || `Meeting ${new Date().toLocaleString()}`,
    startedAt: new Date().toISOString(),
    endedAt: null,
    durationMs: null,
    status: 'recording',
    chunkCount: 0,
    transcript: '',
    summary: '',
    segments: [],
    capture,
  }
  return writeMeeting(meeting)
}

export async function loadStoredMeeting(id: string): Promise<StoredMeeting> {
  const raw = await fs.readFile(meetingFile(id), 'utf8')
  return JSON.parse(raw) as StoredMeeting
}

export function meetingAudioChunkPath(
  id: string,
  chunkIndex: number,
  extension = 'webm',
) {
  if (!Number.isInteger(chunkIndex) || chunkIndex < 0) throw new Error('chunkIndex không hợp lệ.')
  return path.join(
    meetingDir(id),
    'audio',
    `chunk-${String(chunkIndex).padStart(4, '0')}.${safeExtension(extension)}`,
  )
}

export async function saveMeetingAudioChunk(
  id: string,
  bytes: Uint8Array,
  chunkIndex: number,
  extension = 'webm',
) {
  const filePath = meetingAudioChunkPath(id, chunkIndex, extension)
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, bytes)
  return filePath
}

export async function appendMeetingSegments(
  id: string,
  chunkIndex: number,
  incoming: Omit<MeetingSegment, 'chunkIndex'>[],
) {
  const meeting = await loadStoredMeeting(id)
  const withoutChunk = meeting.segments.filter((segment) => segment.chunkIndex !== chunkIndex)
  meeting.segments = [...withoutChunk, ...incoming.map((segment) => ({ ...segment, chunkIndex }))]
    .sort((a, b) => a.start - b.start)
  meeting.chunkCount = Math.max(meeting.chunkCount, chunkIndex + 1)
  meeting.transcript = rebuildTranscript(meeting.segments)
  await writeMeeting(meeting)
  return meeting
}

export async function completeStoredMeeting(id: string, summary: string) {
  const meeting = await loadStoredMeeting(id)
  const endedAt = new Date()
  const startedAt = new Date(meeting.startedAt)
  meeting.endedAt = endedAt.toISOString()
  meeting.durationMs = Math.max(0, endedAt.getTime() - startedAt.getTime())
  meeting.status = 'completed'
  meeting.summary = summary
  meeting.transcript = rebuildTranscript(meeting.segments)
  return writeMeeting(meeting)
}

export async function updateStoredMeetingSummary(id: string, summary: string) {
  const meeting = await loadStoredMeeting(id)
  meeting.summary = summary
  return writeMeeting(meeting)
}

export async function listStoredMeetings(query = '') {
  await fs.mkdir(meetingsRoot(), { recursive: true })
  const entries = await fs.readdir(meetingsRoot(), { withFileTypes: true })
  const needle = query.trim().toLowerCase()
  const meetings: StoredMeeting[] = []

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    try {
      const meeting = await loadStoredMeeting(entry.name)
      if (
        needle &&
        !meeting.title.toLowerCase().includes(needle) &&
        !meeting.transcript.toLowerCase().includes(needle) &&
        !meeting.summary.toLowerCase().includes(needle)
      ) continue
      meetings.push(meeting)
    } catch {
      // Ignore incomplete/corrupt meeting folders rather than breaking the history view.
    }
  }

  return meetings
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .map((meeting) => ({
      id: meeting.id,
      title: meeting.title,
      startedAt: meeting.startedAt,
      endedAt: meeting.endedAt,
      durationMs: meeting.durationMs,
      status: meeting.status,
      chunkCount: meeting.chunkCount,
      transcriptPreview: meeting.transcript.slice(0, 280),
      summaryPreview: meeting.summary.slice(0, 280),
    }))
}
