import { app, BrowserWindow, dialog, globalShortcut, ipcMain } from 'electron'
import path from 'node:path'
import dotenv from 'dotenv'
import { askAssistant, type AssistantMode, type ChatMessage } from './ai/assistant'
import { synthesizeSpeech, transcribeAudio } from './ai/voice'
import { summarizeMeeting } from './ai/meeting'
import { loadHistory, saveHistory, type HistoryMessage } from './storage/history'
import { getWorkspaceRoot, scanWorkspace, setWorkspaceRoot } from './tools/workspace'
import { runProjectCheck, type ProjectCheck } from './tools/coding'
import { applyEditProposal, discardEditProposal, listEditProposals } from './tools/proposals'

dotenv.config({ path: path.resolve(process.cwd(), '.env') })
if (process.env.BAU_WORKSPACE_ROOT?.trim()) setWorkspaceRoot(process.env.BAU_WORKSPACE_ROOT.trim())

let mainWindow: BrowserWindow | null = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 900,
    minHeight: 650,
    title: 'Bâu Bot',
    backgroundColor: '#090b10',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

function registerIpc() {
  ipcMain.handle('config:get', async () => ({
    hasApiKey: Boolean(process.env.OPENAI_API_KEY),
    model: process.env.BAU_MODEL || 'gpt-5.6-sol',
    workspaceRoot: getWorkspaceRoot(),
  }))

  ipcMain.handle('workspace:choose', async () => {
    const options = { title: 'Chọn project cho Bâu Bot', properties: ['openDirectory'] as const }
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || !result.filePaths[0]) return null
    const workspaceRoot = setWorkspaceRoot(result.filePaths[0])
    return { workspaceRoot, scan: await scanWorkspace(200) }
  })
  ipcMain.handle('workspace:scan', (_event, maxFiles?: number) => scanWorkspace(maxFiles ?? 800))

  ipcMain.handle('code:run-check', (_event, check: ProjectCheck) => runProjectCheck(check))
  ipcMain.handle('code:proposals', () => listEditProposals())
  ipcMain.handle('code:apply-proposal', (_event, id: string) => applyEditProposal(id))
  ipcMain.handle('code:discard-proposal', (_event, id: string) => discardEditProposal(id))

  ipcMain.handle('history:load', () => loadHistory())
  ipcMain.handle('history:save', (_event, messages: HistoryMessage[]) => saveHistory(messages))

  ipcMain.handle(
    'ai:ask',
    async (_event, payload: { messages: ChatMessage[]; mode: AssistantMode }) =>
      askAssistant(payload.messages, payload.mode),
  )

  ipcMain.handle(
    'audio:transcribe',
    async (_event, payload: { bytes: ArrayBuffer; extension?: string }) =>
      transcribeAudio(new Uint8Array(payload.bytes), payload.extension || 'webm'),
  )

  ipcMain.handle('audio:speak', async (_event, text: string) => synthesizeSpeech(text))
  ipcMain.handle('meeting:summarize', async (_event, transcript: string) => summarizeMeeting(transcript))
}

app.whenReady().then(() => {
  registerIpc()
  createWindow()

  globalShortcut.register('CommandOrControl+Space', () => {
    mainWindow?.webContents.send('voice:toggle')
    if (mainWindow?.isMinimized()) mainWindow.restore()
    mainWindow?.show()
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('will-quit', () => globalShortcut.unregisterAll())
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
