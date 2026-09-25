import OpenAI from 'openai'
import { openApp, openFolder } from '../tools/windows'
import { listDirectory, readTextFile, scanWorkspace, searchWorkspace } from '../tools/workspace'
import { getProjectOverview, runProjectCheck, type ProjectCheck } from '../tools/coding'
import { createEditProposal } from '../tools/proposals'

export type AssistantMode = 'chat' | 'code'
export type ChatMessage = { role: 'user' | 'assistant'; content: string }

const BASE_INSTRUCTIONS = `Bạn là Bâu Bot, trợ lý AI chạy trên Windows của Tri.
- Mặc định trả lời bằng tiếng Việt, trừ khi người dùng yêu cầu ngôn ngữ khác.
- Ngắn gọn nhưng chính xác.
- Khi người dùng yêu cầu mở ứng dụng/folder và tool phù hợp tồn tại, hãy dùng tool thay vì chỉ hướng dẫn.
- Không được giả vờ đã thực hiện thao tác nếu tool thất bại.
- Không được truy cập file bên ngoài workspace coding hiện tại.
- Không được tự ý xóa file, cài package, git push, thay đổi registry, shutdown máy hoặc chạy command tùy ý.`

const commonTools: any[] = [
  {
    type: 'function',
    name: 'open_app',
    description: 'Mở một ứng dụng Windows nằm trong allowlist an toàn như VS Code, File Explorer, Notepad, Calculator, Windows Terminal hoặc Microsoft Edge.',
    parameters: {
      type: 'object',
      properties: { app: { type: 'string' } },
      required: ['app'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: 'function',
    name: 'open_folder',
    description: 'Mở một folder đã tồn tại bằng Windows File Explorer.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
      additionalProperties: false,
    },
    strict: true,
  },
]

const codingTools: any[] = [
  {
    type: 'function',
    name: 'project_overview',
    description: 'Xem tên project, package manager, npm scripts và dependency chính trong workspace coding hiện tại.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    strict: true,
  },
  {
    type: 'function',
    name: 'scan_workspace',
    description: 'Quét cây file của workspace coding hiện tại. Tự bỏ qua node_modules, build output và .git.',
    parameters: {
      type: 'object',
      properties: { maxFiles: { type: 'integer', minimum: 1, maximum: 1200 } },
      required: ['maxFiles'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: 'function',
    name: 'list_directory',
    description: 'Liệt kê file/folder bên trong coding workspace. Path có thể là tương đối với workspace.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: 'function',
    name: 'read_text_file',
    description: 'Đọc một text/code file <= 1MB bên trong coding workspace. Chỉ gọi sau khi biết file nào có liên quan.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: 'function',
    name: 'search_workspace',
    description: 'Tìm text trong các source file của workspace và trả về path + line. Dùng để tìm component, function, error string hoặc symbol.',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: 'function',
    name: 'run_project_check',
    description: 'Chạy đúng một script kiểm tra có sẵn trong package.json: build, test, lint hoặc typecheck. Không nhận command tùy ý.',
    parameters: {
      type: 'object',
      properties: { check: { type: 'string', enum: ['build', 'test', 'lint', 'typecheck'] } },
      required: ['check'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: 'function',
    name: 'propose_file_edit',
    description: 'Tạo patch CHỜ DUYỆT cho một file trong workspace. Tool này không ghi file. Chỉ dùng khi người dùng yêu cầu sửa/tạo code. Phải đọc file hiện tại trước khi sửa file đang tồn tại. Truyền toàn bộ nội dung file sau khi sửa.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        summary: { type: 'string' },
        content: { type: 'string' },
      },
      required: ['path', 'summary', 'content'],
      additionalProperties: false,
    },
    strict: true,
  },
]

function openai() {
  if (!process.env.OPENAI_API_KEY) throw new Error('Chưa cấu hình OPENAI_API_KEY trong file .env')
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
}

async function executeTool(name: string, args: any) {
  try {
    switch (name) {
      case 'open_app': return await openApp(args.app)
      case 'open_folder': return await openFolder(args.path)
      case 'project_overview': return await getProjectOverview()
      case 'scan_workspace': return await scanWorkspace(args.maxFiles)
      case 'list_directory': return await listDirectory(args.path)
      case 'read_text_file': return await readTextFile(args.path)
      case 'search_workspace': return await searchWorkspace(args.query)
      case 'run_project_check': return await runProjectCheck(args.check as ProjectCheck)
      case 'propose_file_edit': return await createEditProposal(args.path, args.content, args.summary)
      default: return { ok: false, error: `Unknown tool: ${name}` }
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export async function askAssistant(messages: ChatMessage[], mode: AssistantMode = 'chat') {
  const codingInstructions = mode === 'code'
    ? `\nBạn đang ở Coding Mode và hành xử như senior pair programmer.
- Khi cần context dự án, chủ động dùng project_overview, scan_workspace, search_workspace và read_text_file. Không bịa nội dung file chưa đọc.
- Khi người dùng hỏi vì sao build/test lỗi, hãy chạy check phù hợp nếu project có script đó rồi đọc file liên quan.
- Nếu người dùng yêu cầu sửa code, dùng propose_file_edit để tạo patch chờ họ duyệt. Tuyệt đối không nói file đã được sửa trước khi người dùng Apply patch trong UI.
- Sau khi tạo patch, nói rõ patch đang chờ duyệt ở panel bên phải.
- Không tạo thay đổi ngoài phạm vi người dùng yêu cầu.`
    : ''

  const input: any[] = messages.slice(-30).map((message) => ({ role: message.role, content: message.content }))
  const tools = mode === 'code' ? [...commonTools, ...codingTools] : commonTools

  const createResponse = () => openai().responses.create({
    model: process.env.BAU_MODEL || 'gpt-5.6-sol',
    reasoning: { effort: (process.env.BAU_REASONING_EFFORT || 'medium') as any },
    instructions: BASE_INSTRUCTIONS + codingInstructions,
    input,
    tools,
  })

  let response: any = await createResponse()

  for (let turn = 0; turn < 10; turn += 1) {
    const calls = (response.output ?? []).filter((item: any) => item.type === 'function_call')
    if (calls.length === 0) return response.output_text?.trim() || 'Mình chưa tạo được câu trả lời.'

    input.push(...(response.output ?? []))
    for (const call of calls) {
      let args: any = {}
      try { args = JSON.parse(call.arguments || '{}') } catch { args = {} }
      const result = await executeTool(call.name, args)
      input.push({ type: 'function_call_output', call_id: call.call_id, output: JSON.stringify(result) })
    }
    response = await createResponse()
  }

  return response.output_text?.trim() || 'Bâu Bot đã đạt giới hạn vòng tool cho yêu cầu này.'
}
