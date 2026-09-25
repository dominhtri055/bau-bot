import { promises as fs } from 'node:fs'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { assertCanonicalInsideWorkspace, getWorkspaceRoot, resolveWorkspacePath } from './workspace'

export type ProjectCheck = 'build' | 'test' | 'lint' | 'typecheck'

async function fileExists(filePath: string) {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

export async function getProjectOverview() {
  const root = getWorkspaceRoot()
  const packagePath = path.join(root, 'package.json')
  let packageJson: any = null

  if (await fileExists(packagePath)) {
    try {
      packageJson = JSON.parse(await fs.readFile(packagePath, 'utf8'))
    } catch {
      packageJson = { error: 'package.json không phải JSON hợp lệ.' }
    }
  }

  const manager = (await fileExists(path.join(root, 'pnpm-lock.yaml')))
    ? 'pnpm'
    : (await fileExists(path.join(root, 'yarn.lock')))
      ? 'yarn'
      : (await fileExists(path.join(root, 'bun.lockb'))) || (await fileExists(path.join(root, 'bun.lock')))
        ? 'bun'
        : 'npm'

  return {
    root,
    packageManager: packageJson ? manager : null,
    name: packageJson?.name ?? path.basename(root),
    scripts: packageJson?.scripts ?? {},
    dependencies: Object.keys(packageJson?.dependencies ?? {}),
    devDependencies: Object.keys(packageJson?.devDependencies ?? {}),
  }
}

function commandFor(manager: string, script: string) {
  if (manager === 'yarn') return { command: process.platform === 'win32' ? 'yarn.cmd' : 'yarn', args: [script] }
  if (manager === 'pnpm') return { command: process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', args: ['run', script] }
  if (manager === 'bun') return { command: process.platform === 'win32' ? 'bun.exe' : 'bun', args: ['run', script] }
  return { command: process.platform === 'win32' ? 'npm.cmd' : 'npm', args: ['run', script] }
}

export async function runProjectCheck(check: ProjectCheck) {
  const overview = await getProjectOverview()
  if (!overview.packageManager) return { ok: false, error: 'Workspace hiện tại không có package.json.' }

  const scripts = overview.scripts as Record<string, string>
  const candidates: Record<ProjectCheck, string[]> = {
    build: ['build'],
    test: ['test'],
    lint: ['lint'],
    typecheck: ['typecheck', 'type-check', 'check-types'],
  }
  const script = candidates[check].find((name) => typeof scripts[name] === 'string')
  if (!script) {
    return { ok: false, error: `Project không có script ${check}.`, availableScripts: Object.keys(scripts) }
  }

  const { command, args } = commandFor(overview.packageManager, script)
  const cwd = getWorkspaceRoot()
  const startedAt = Date.now()

  return await new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, CI: '1', NO_COLOR: '1' },
      windowsHide: true,
      shell: false,
    })

    let stdout = ''
    let stderr = ''
    let timedOut = false
    const append = (current: string, chunk: Buffer) => (current + chunk.toString('utf8')).slice(-120_000)

    child.stdout?.on('data', (chunk: Buffer) => { stdout = append(stdout, chunk) })
    child.stderr?.on('data', (chunk: Buffer) => { stderr = append(stderr, chunk) })

    const timeout = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
    }, 90_000)

    child.on('error', (error) => {
      clearTimeout(timeout)
      resolve({ ok: false, error: error.message, stdout, stderr, durationMs: Date.now() - startedAt })
    })

    child.on('close', (code) => {
      clearTimeout(timeout)
      resolve({
        ok: code === 0 && !timedOut,
        exitCode: code,
        timedOut,
        stdout,
        stderr,
        durationMs: Date.now() - startedAt,
        command: `${command} ${args.join(' ')}`,
      })
    })
  })
}

export async function ensureEditableFile(requestedPath: string) {
  const target = resolveWorkspacePath(requestedPath)
  await assertCanonicalInsideWorkspace(target, true)
  try {
    const stat = await fs.stat(target)
    if (!stat.isFile()) throw new Error('Đường dẫn không phải file.')
    if (stat.size > 1_000_000) throw new Error('Không tạo patch cho file > 1 MB.')
  } catch (error: any) {
    if (error?.code !== 'ENOENT') throw error
  }
  return target
}
