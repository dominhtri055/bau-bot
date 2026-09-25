import OpenAI from 'openai'

function client() {
  if (!process.env.OPENAI_API_KEY) throw new Error('Chưa cấu hình OPENAI_API_KEY trong file .env')
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
}

export async function summarizeMeeting(transcript: string) {
  if (!transcript.trim()) throw new Error('Transcript đang trống.')

  const response = await client().responses.create({
    model: process.env.BAU_MODEL || 'gpt-5.6-sol',
    reasoning: { effort: 'medium' },
    instructions: `Bạn là meeting assistant của Bâu Bot. Hãy tóm tắt transcript bằng tiếng Việt. Trả về markdown với đúng các mục: Tóm tắt, Quyết định, Việc cần làm, Deadline, Câu hỏi còn mở. Không tự bịa tên người hay deadline nếu transcript không có.`,
    input: transcript.slice(0, 120_000),
  })

  return response.output_text.trim()
}
