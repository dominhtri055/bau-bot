import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const IGNORED_DIRS = new Set([
  '.git',
  '.next',
  '.idea',
  '.vscode',
  'node_modules',
  'dist',
  'out',
  'build',
  'release',
  'coverage',
  '.turbo',
])

let selectedWorkspaceRoot = path.resolve(process.env.BAU_WORKSPACE_ROOT?.trim() || os.homedir())

function isInside(root: string, target: string) {
  const relative = path.relative(root, target)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

export async function assertCanonicalInsideWorkspace(target: string, allowMissing = false) {
  const root = await fs.realpath(getWorkspaceRoot()).catch(() => getWorkspaceRoot())
  let canonicalTarget: string
  try {
    canonicalTarget = await fs.realpath(target)
  } catch (error: any) {
    if (!allowMissing || error?.code !== 'ENOENT') throw error
    const parent = await fs.realpath(path.dirname(target))
    canonicalTarget = path.join(parent, path.basename(target))
  }
  if (!isInside(root, canonicalTarget)) {
    throw new Error(`Đường dẫn thực tế nằm ngoài workspace: ${getWorkspaceRoot()}`)
  }
  return target
}

export function getWorkspaceRoot() {
  return selectedWorkspaceRoot
}

export function setWorkspaceRoot(nextRoot: string) {
  selectedWorkspaceRoot = path.resolve(nextRoot)
  return selectedWorkspaceRoot
}

export function resolveWorkspacePath(requested = '.') {
  const root = getWorkspaceRoot()
  const expanded = requested.replace(/^~(?=$|[\\/])/, os.homedir())
  const target = path.isAbsolute(expanded) ? path.resolve(expanded) : path.resolve(root, expanded)
  if (!isInside(root, target)) throw new Error(`Chỉ được truy cập file bên trong workspace: ${root}`)
  return target
}

export async function listDirectory(requestedPath = '.') {
  const target = resolveWorkspacePath(requestedPath)
  await assertCanonicalInsideWorkspace(target)
  const entries = await fs.readdir(target, { withFileTypes: true })
  return {
    path: target,
    entries: entries
      .filter((entry) => !IGNORED_DIRS.has(entry.name))
      .slice(0, 250)
      .map((entry) => ({
        name: entry.name,
        type: entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'other',
      })),
  }
}

export async function readTextFile(requestedPath: string) {
  const target = resolveWorkspacePath(requestedPath)
  await assertCanonicalInsideWorkspace(target)
  const stat = await fs.stat(target)
  if (!stat.isFile()) throw new Error('Đường dẫn không phải file.')
  if (stat.size > 1_000_000) throw new Error('Chỉ đọc file <= 1 MB.')
  const content = await fs.readFile(target, 'utf8')
  return { path: target, relativePath: path.relative(getWorkspaceRoot(), target), content }
}

export async function scanWorkspace(maxFiles = 800) {
  const root = getWorkspaceRoot()
  const files: { path: string; size: number }[] = []
  const stack = [root]

  while (stack.length && files.length < maxFiles) {
    const current = stack.pop()!
    let entries
    try {
      entries = await fs.readdir(current, { withFileTypes: true })
    } catch {
      continue
    }

    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.name !== '.env.example') continue
      if (IGNORED_DIRS.has(entry.name)) continue
      const absolute = path.join(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(absolute)
      } else if (entry.isFile()) {
        try {
          const stat = await fs.stat(absolute)
          files.push({ path: path.relative(root, absolute), size: stat.size })
        } catch {
          // Ignore files that disappear during the scan.
        }
      }
      if (files.length >= maxFiles) break
    }
  }

  return { root, files, truncated: files.length >= maxFiles }
}

export async function searchWorkspace(query: string, maxResults = 60) {
  const needle = query.trim().toLowerCase()
  if (!needle) return { query, results: [] }

  const { files } = await scanWorkspace(1200)
  const results: { path: string; line: number; text: string }[] = []

  for (const file of files) {
    if (results.length >= maxResults) break
    if (file.size > 400_000) continue
    if (/\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|mp4|mp3|wav|woff2?|ttf|lock)$/i.test(file.path)) continue

    try {
      const content = await fs.readFile(resolveWorkspacePath(file.path), 'utf8')
      const lines = content.split(/\r?\n/)
      for (let i = 0; i < lines.length; i += 1) {
        if (lines[i].toLowerCase().includes(needle)) {
          results.push({ path: file.path, line: i + 1, text: lines[i].trim().slice(0, 300) })
          if (results.length >= maxResults) break
        }
      }
    } catch {
      // Skip non-text files and transient read failures.
    }
  }

  return { query, results }
}
