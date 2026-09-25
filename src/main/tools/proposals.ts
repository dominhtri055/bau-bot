import { app } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { ensureEditableFile } from './coding'
import { getWorkspaceRoot } from './workspace'

export type EditProposal = {
  id: string
  path: string
  absolutePath: string
  summary: string
  oldContent: string
  newContent: string
  createdAt: string
}

const proposals = new Map<string, EditProposal>()

function lineDiff(before: string, after: string) {
  if (before === after) return 'Không có thay đổi.'
  const oldLines = before.split(/\r?\n/)
  const newLines = after.split(/\r?\n/)
  let start = 0
  while (start < oldLines.length && start < newLines.length && oldLines[start] === newLines[start]) start += 1
  let oldEnd = oldLines.length - 1
  let newEnd = newLines.length - 1
  while (oldEnd >= start && newEnd >= start && oldLines[oldEnd] === newLines[newEnd]) {
    oldEnd -= 1
    newEnd -= 1
  }

  const contextStart = Math.max(0, start - 3)
  const contextOldEnd = Math.min(oldLines.length - 1, oldEnd + 3)
  const contextNewEnd = Math.min(newLines.length - 1, newEnd + 3)
  const lines = [`@@ around line ${start + 1} @@`]

  for (let i = contextStart; i < start; i += 1) lines.push(`  ${oldLines[i] ?? ''}`)
  for (let i = start; i <= oldEnd; i += 1) lines.push(`- ${oldLines[i] ?? ''}`)
  for (let i = start; i <= newEnd; i += 1) lines.push(`+ ${newLines[i] ?? ''}`)
  const trailingCount = Math.max(contextOldEnd - oldEnd, contextNewEnd - newEnd)
  for (let offset = 1; offset <= trailingCount; offset += 1) {
    const line = newLines[newEnd + offset] ?? oldLines[oldEnd + offset] ?? ''
    lines.push(`  ${line}`)
  }

  return lines.slice(0, 500).join('\n')
}

export async function createEditProposal(requestedPath: string, newContent: string, summary: string) {
  const target = await ensureEditableFile(requestedPath)
  let oldContent = ''
  try {
    oldContent = await fs.readFile(target, 'utf8')
  } catch (error: any) {
    if (error?.code !== 'ENOENT') throw error
  }

  if (newContent.length > 1_500_000) throw new Error('Patch quá lớn.')
  const proposal: EditProposal = {
    id: crypto.randomUUID(),
    path: path.relative(getWorkspaceRoot(), target),
    absolutePath: target,
    summary: summary.trim() || 'Đề xuất chỉnh sửa code',
    oldContent,
    newContent,
    createdAt: new Date().toISOString(),
  }
  proposals.set(proposal.id, proposal)
  return { id: proposal.id, path: proposal.path, summary: proposal.summary, diff: lineDiff(oldContent, newContent) }
}

export function listEditProposals() {
  return [...proposals.values()].map((proposal) => ({
    id: proposal.id,
    path: proposal.path,
    summary: proposal.summary,
    createdAt: proposal.createdAt,
    diff: lineDiff(proposal.oldContent, proposal.newContent),
  }))
}

export async function applyEditProposal(id: string) {
  const proposal = proposals.get(id)
  if (!proposal) throw new Error('Patch không còn tồn tại.')
  const target = await ensureEditableFile(proposal.path)
  const current = await fs.readFile(target, 'utf8').catch((error: any) => {
    if (error?.code === 'ENOENT') return ''
    throw error
  })
  if (current !== proposal.oldContent) {
    throw new Error('File đã thay đổi kể từ lúc patch được tạo. Hãy yêu cầu Bâu Bot tạo patch mới.')
  }

  const backupRoot = path.join(app.getPath('userData'), 'patch-backups', new Date().toISOString().replace(/[:.]/g, '-'))
  const relative = proposal.path || path.basename(target)
  const backupPath = path.join(backupRoot, relative)
  await fs.mkdir(path.dirname(backupPath), { recursive: true })
  if (proposal.oldContent) await fs.writeFile(backupPath, proposal.oldContent, 'utf8')

  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.writeFile(target, proposal.newContent, 'utf8')
  proposals.delete(id)
  return { ok: true, path: proposal.path, backupPath: proposal.oldContent ? backupPath : null }
}

export function discardEditProposal(id: string) {
  return proposals.delete(id)
}
