import { shell } from 'electron'
import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const APP_COMMANDS: Record<string, { command: string; args?: string[] }> = {
  vscode: { command: 'code' },
  'vs code': { command: 'code' },
  'visual studio code': { command: 'code' },
  explorer: { command: 'explorer.exe' },
  'file explorer': { command: 'explorer.exe' },
  notepad: { command: 'notepad.exe' },
  calculator: { command: 'calc.exe' },
  terminal: { command: 'wt.exe' },
  'windows terminal': { command: 'wt.exe' },
  edge: { command: 'msedge.exe' },
  'microsoft edge': { command: 'msedge.exe' },
}

function normalizeAppName(name: string): string {
  return name.trim().toLowerCase()
}

export async function openApp(appName: string) {
  if (process.platform !== 'win32') {
    return { ok: false, message: 'open_app hiện chỉ được bật trên Windows.' }
  }

  const config = APP_COMMANDS[normalizeAppName(appName)]
  if (!config) {
    return {
      ok: false,
      message: `Ứng dụng "${appName}" chưa nằm trong allowlist an toàn của Bâu Bot.`,
    }
  }

  const child = spawn(config.command, config.args ?? [], {
    detached: true,
    stdio: 'ignore',
    shell: config.command === 'code',
    windowsHide: true,
  })
  child.unref()
  return { ok: true, message: `Đã mở ${appName}.` }
}

export async function openFolder(folderPath: string) {
  const resolved = path.resolve(folderPath.replace(/^~(?=$|[\\/])/, os.homedir()))
  try {
    const stat = await fs.stat(resolved)
    if (!stat.isDirectory()) return { ok: false, message: 'Đường dẫn không phải folder.' }
  } catch {
    return { ok: false, message: 'Không tìm thấy folder.' }
  }

  const error = await shell.openPath(resolved)
  if (error) return { ok: false, message: error }
  return { ok: true, message: `Đã mở folder ${resolved}` }
}
