import { app } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'

export type HistoryMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string
}

const historyPath = () => path.join(app.getPath('userData'), 'bau-bot-history.json')

export async function loadHistory(): Promise<HistoryMessage[]> {
  try {
    const raw = await fs.readFile(historyPath(), 'utf8')
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export async function saveHistory(messages: HistoryMessage[]): Promise<void> {
  await fs.mkdir(path.dirname(historyPath()), { recursive: true })
  await fs.writeFile(historyPath(), JSON.stringify(messages.slice(-200), null, 2), 'utf8')
}
