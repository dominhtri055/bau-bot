import OpenAI from 'openai'
import { createReadStream } from 'node:fs'
import crypto from 'node:crypto'
import {
  appendMeetingSegments,
  completeStoredMeeting,
  loadStoredMeeting,
  type MeetingSegment,
} from '../storage/meetings'

function client() {
  if (!process.env.OPENAI_API_KEY) throw new Error('Chưa cấu hình OPENAI_API_KEY trong file .env')
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
}

export async function summarizeMeeting(transcript: string) {
  if (!transcript.trim()) throw new Error('Transcript đang trống.')

  const response = await client().responses.create({
    model: process.env.BAU_MODEL || 'gpt-5.6-sol',
    reasoning: { effort: 'medium' },
    instructions: `Bạn là meeting assistant của Bâu Bot. Hãy tóm tắt transcript bằng tiếng Việt.
Trả về markdown với đúng các mục:
## Tóm tắt
## Quyết định
## Việc cần làm
## Deadline
## Câu hỏi còn mở
Không tự bịa tên người, quyết định hay deadline nếu transcript không có. Nếu transcript có nhiều speaker label (A, B...), giữ nguyên label khi không biết tên thật.`,
    input: transcript.slice(0, 180_000),
  })

  return response.output_text.trim()
}

type RawDiarizedSegment = {
  id?: string
  speaker?: string
  start?: number
  end?: number
  text?: string
}

export async function transcribeMeetingChunk(
  meetingId: string,
  filePath: string,
  chunkIndex: number,
  offsetSeconds: number,
) {
  const api = client()
  const diarizeModel = process.env.BAU_MEETING_TRANSCRIBE_MODEL || 'gpt-4o-transcribe-diarize'
  const language = process.env.BAU_MEETING_LANGUAGE?.trim() || 'vi'

  try {
    const result: any = await api.audio.transcriptions.create({
      file: createReadStream(filePath),
      model: diarizeModel,
      response_format: 'diarized_json',
      language,
    } as any)

    const rawSegments: RawDiarizedSegment[] = Array.isArray(result.segments) ? result.segments : []
    const segments: Omit<MeetingSegment, 'chunkIndex'>[] = rawSegments
      .filter((segment) => segment.text?.trim())
      .map((segment) => ({
        id: segment.id || crypto.randomUUID(),
        speaker: segment.speaker || '?',
        start: offsetSeconds + Number(segment.start || 0),
        end: offsetSeconds + Number(segment.end || segment.start || 0),
        text: segment.text!.trim(),
      }))

    if (segments.length === 0 && String(result.text || '').trim()) {
      segments.push({
        id: crypto.randomUUID(),
        speaker: '?',
        start: offsetSeconds,
        end: offsetSeconds,
        text: String(result.text).trim(),
      })
    }

    const meeting = await appendMeetingSegments(meetingId, chunkIndex, segments)
    return {
      diarized: rawSegments.length > 0,
      transcript: meeting.transcript,
      segments: meeting.segments.filter((segment) => segment.chunkIndex === chunkIndex),
    }
  } catch (diarizeError) {
    const fallbackModel = process.env.BAU_TRANSCRIBE_MODEL || 'gpt-4o-transcribe'
    if (fallbackModel === diarizeModel) throw diarizeError

    const fallback: any = await api.audio.transcriptions.create({
      file: createReadStream(filePath),
      model: fallbackModel,
      language,
    } as any)

    const text = String(fallback.text || '').trim()
    const segments: Omit<MeetingSegment, 'chunkIndex'>[] = text
      ? [{
          id: crypto.randomUUID(),
          speaker: '?',
          start: offsetSeconds,
          end: offsetSeconds,
          text,
        }]
      : []

    const meeting = await appendMeetingSegments(meetingId, chunkIndex, segments)
    return {
      diarized: false,
      fallbackReason: diarizeError instanceof Error ? diarizeError.message : String(diarizeError),
      transcript: meeting.transcript,
      segments: meeting.segments.filter((segment) => segment.chunkIndex === chunkIndex),
    }
  }
}

export async function finishMeeting(meetingId: string) {
  const meeting = await loadStoredMeeting(meetingId)
  const summary = meeting.transcript.trim()
    ? await summarizeMeeting(meeting.transcript)
    : 'Không có transcript để tóm tắt.'
  return completeStoredMeeting(meetingId, summary)
}
