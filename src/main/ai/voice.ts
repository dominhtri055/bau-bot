import OpenAI from 'openai'
import { createReadStream, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'

function client() {
  if (!process.env.OPENAI_API_KEY) throw new Error('Chưa cấu hình OPENAI_API_KEY trong file .env')
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
}

export async function transcribeAudio(bytes: Uint8Array, extension = 'webm') {
  const tempFile = path.join(os.tmpdir(), `bau-bot-${crypto.randomUUID()}.${extension}`)
  await fs.writeFile(tempFile, bytes)

  try {
    const transcript = await client().audio.transcriptions.create({
      file: createReadStream(tempFile),
      model: process.env.BAU_TRANSCRIBE_MODEL || 'gpt-4o-transcribe',
      language: 'vi',
    })
    return transcript.text.trim()
  } finally {
    await fs.unlink(tempFile).catch(() => undefined)
  }
}

export async function synthesizeSpeech(text: string) {
  const speech = await client().audio.speech.create({
    model: process.env.BAU_TTS_MODEL || 'gpt-4o-mini-tts',
    voice: (process.env.BAU_TTS_VOICE || 'coral') as any,
    input: text.slice(0, 4000),
    instructions: 'Nói tiếng Việt tự nhiên, rõ ràng, thân thiện, tốc độ vừa phải. Không đọc markdown formatting.',
    response_format: 'mp3',
  })

  const buffer = Buffer.from(await speech.arrayBuffer())
  return `data:audio/mpeg;base64,${buffer.toString('base64')}`
}
