import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'

type Mode = 'chat' | 'code' | 'meeting'
type Message = { id: string; role: 'user' | 'assistant'; content: string; createdAt: string }
type Config = { hasApiKey: boolean; model: string; workspaceRoot: string }
type Proposal = { id: string; path: string; summary: string; createdAt: string; diff: string }

const welcome: Message = {
  id: 'welcome',
  role: 'assistant',
  content: 'Chào Tri. Mình là Bâu Bot. Bạn có thể chat, chọn Coding để làm việc với project, hoặc nhấn Ctrl+Space để nói.',
  createdAt: new Date().toISOString(),
}

function newMessage(role: Message['role'], content: string): Message {
  return { id: crypto.randomUUID(), role, content, createdAt: new Date().toISOString() }
}

export default function App() {
  const [mode, setMode] = useState<Mode>('chat')
  const [messages, setMessages] = useState<Message[]>([welcome])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [recording, setRecording] = useState(false)
  const [voiceEnabled, setVoiceEnabled] = useState(true)
  const [status, setStatus] = useState('Sẵn sàng')
  const [config, setConfig] = useState<Config | null>(null)
  const [proposals, setProposals] = useState<Proposal[]>([])
  const [meetingTranscript, setMeetingTranscript] = useState('')
  const [meetingSummary, setMeetingSummary] = useState('')

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const messagesEnd = useRef<HTMLDivElement | null>(null)

  const refreshProposals = useCallback(async () => {
    try { setProposals(await window.bau.listProposals()) } catch (error) { console.error(error) }
  }, [])

  useEffect(() => {
    Promise.all([window.bau.getConfig(), window.bau.loadHistory(), window.bau.listProposals()]).then(([cfg, history, pending]) => {
      setConfig(cfg)
      setProposals(pending)
      if (history.length) setMessages(history)
    })
  }, [])

  useEffect(() => {
    if (messages.length && messages[0]?.id !== 'welcome') {
      window.bau.saveHistory(messages.filter((m) => m.id !== 'welcome')).catch(console.error)
    }
    messagesEnd.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    if (mode === 'code') void refreshProposals()
  }, [mode, refreshProposals])

  const ask = useCallback(async (content: string) => {
    const trimmed = content.trim()
    if (!trimmed || busy) return

    const user = newMessage('user', trimmed)
    const next = [...messages.filter((m) => m.id !== 'welcome'), user]
    setMessages((prev) => [...prev, user])
    setInput('')
    setBusy(true)
    setStatus(mode === 'code' ? 'Đang phân tích project…' : 'Đang suy nghĩ…')

    try {
      const answer = await window.bau.ask({
        messages: next.map(({ role, content: text }) => ({ role, content: text })),
        mode: mode === 'code' ? 'code' : 'chat',
      })
      setMessages((prev) => [...prev, newMessage('assistant', answer)])
      if (mode === 'code') await refreshProposals()
      setStatus('Sẵn sàng')

      if (voiceEnabled && answer.length <= 1800) {
        const audioUrl = await window.bau.speak(answer)
        const audio = new Audio(audioUrl)
        await audio.play().catch(() => undefined)
      }
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error)
      setMessages((prev) => [...prev, newMessage('assistant', `Có lỗi: ${text}`)])
      setStatus('Có lỗi')
    } finally {
      setBusy(false)
    }
  }, [busy, messages, mode, refreshProposals, voiceEnabled])

  const stopRecording = useCallback(() => mediaRecorderRef.current?.stop(), [])

  const startRecording = useCallback(async () => {
    if (busy) return
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      chunksRef.current = []
      const recorder = new MediaRecorder(stream)
      mediaRecorderRef.current = recorder

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data)
      }

      recorder.onstop = async () => {
        setRecording(false)
        setStatus('Đang nhận dạng tiếng Việt…')
        stream.getTracks().forEach((track) => track.stop())

        try {
          const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })
          const transcript = await window.bau.transcribe(await blob.arrayBuffer(), 'webm')
          if (mode === 'meeting') {
            setMeetingTranscript((previous) => [previous, transcript].filter(Boolean).join('\n'))
            setStatus('Đã thêm vào transcript')
          } else if (transcript) {
            setStatus('Đã nhận giọng nói')
            await ask(transcript)
          }
        } catch (error) {
          setStatus('Không nhận được giọng nói')
          console.error(error)
        }
      }

      recorder.start()
      setRecording(true)
      setStatus('Đang nghe… nhấn Ctrl+Space lần nữa để gửi')
    } catch (error) {
      setStatus('Không truy cập được microphone')
      console.error(error)
    }
  }, [ask, busy, mode])

  const toggleRecording = useCallback(() => {
    if (recording) stopRecording()
    else void startRecording()
  }, [recording, startRecording, stopRecording])

  useEffect(() => window.bau.onVoiceToggle(toggleRecording), [toggleRecording])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    void ask(input)
  }

  const chooseWorkspace = async () => {
    try {
      const result = await window.bau.chooseWorkspace()
      if (!result) return
      setConfig((current) => current ? { ...current, workspaceRoot: result.workspaceRoot } : current)
      setStatus('Đã đổi project')
      await refreshProposals()
    } catch (error) {
      setStatus('Không chọn được project')
      console.error(error)
    }
  }

  const applyProposal = async (id: string) => {
    setBusy(true)
    setStatus('Đang áp dụng patch…')
    try {
      const result = await window.bau.applyProposal(id)
      await refreshProposals()
      setMessages((prev) => [...prev, newMessage('assistant', `Đã áp dụng patch vào ${result.path}.${result.backupPath ? ' Bản cũ đã được backup.' : ''}`)])
      setStatus('Patch đã áp dụng')
    } catch (error) {
      setStatus('Apply patch thất bại')
      setMessages((prev) => [...prev, newMessage('assistant', `Không thể apply patch: ${error instanceof Error ? error.message : String(error)}`)])
    } finally {
      setBusy(false)
    }
  }

  const discardProposal = async (id: string) => {
    await window.bau.discardProposal(id)
    await refreshProposals()
    setStatus('Đã bỏ patch')
  }

  const summarize = async () => {
    if (!meetingTranscript.trim() || busy) return
    setBusy(true)
    setStatus('Đang tóm tắt meeting…')
    try {
      setMeetingSummary(await window.bau.summarizeMeeting(meetingTranscript))
      setStatus('Đã tóm tắt meeting')
    } catch (error) {
      setMeetingSummary(`Có lỗi: ${error instanceof Error ? error.message : String(error)}`)
      setStatus('Có lỗi')
    } finally {
      setBusy(false)
    }
  }

  const modeTitle = useMemo(() => ({ chat: 'Trợ lý', code: 'Coding', meeting: 'Meeting' })[mode], [mode])

  const messageList = (
    <section className="messages">
      {messages.map((message) => (
        <article key={message.id} className={`message ${message.role}`}>
          <div className="avatar">{message.role === 'assistant' ? 'B' : 'T'}</div>
          <div className="bubble">
            <span>{message.role === 'assistant' ? 'Bâu Bot' : 'Bạn'}</span>
            <p>{message.content}</p>
          </div>
        </article>
      ))}
      {busy && <div className="thinking"><i /><i /><i /></div>}
      <div ref={messagesEnd} />
    </section>
  )

  const composer = (
    <section className="composer-wrap">
      {mode === 'code' && (
        <div className="mode-note">Bâu Bot có thể đọc project + chạy check. Mọi thay đổi file phải qua <strong>Patch Approval</strong>.</div>
      )}
      <form className="composer" onSubmit={submit}>
        <button type="button" className={`mic ${recording ? 'live' : ''}`} onClick={toggleRecording} title="Ctrl+Space">
          {recording ? '■' : '●'}
        </button>
        <textarea
          rows={1}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              if (input.trim()) void ask(input)
            }
          }}
          placeholder={mode === 'code' ? 'Ví dụ: scan project, chạy build và sửa lỗi cho tôi…' : 'Nhắn cho Bâu Bot…'}
        />
        <button className="send" disabled={busy || !input.trim()} type="submit">↑</button>
      </form>
      <div className="hint"><kbd>Ctrl</kbd> + <kbd>Space</kbd> bật/tắt ghi âm · <kbd>Enter</kbd> gửi · <kbd>Shift+Enter</kbd> xuống dòng</div>
    </section>
  )

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-orb">B</div>
          <div><strong>Bâu Bot</strong><span>Windows AI Assistant</span></div>
        </div>

        <nav className="nav">
          <button className={mode === 'chat' ? 'active' : ''} onClick={() => setMode('chat')}>◉ Trợ lý</button>
          <button className={mode === 'code' ? 'active' : ''} onClick={() => setMode('code')}>⌘ Coding</button>
          <button className={mode === 'meeting' ? 'active' : ''} onClick={() => setMode('meeting')}>▣ Meeting</button>
        </nav>

        <div className="side-card">
          <span className="eyebrow">MODEL</span>
          <strong>{config?.model ?? 'Đang tải…'}</strong>
          <small>{config?.hasApiKey ? 'API đã cấu hình' : 'Cần thêm OPENAI_API_KEY'}</small>
        </div>

        <div className="side-card workspace">
          <span className="eyebrow">WORKSPACE</span>
          <small title={config?.workspaceRoot}>{config?.workspaceRoot ?? '—'}</small>
          <button className="subtle" onClick={() => void chooseWorkspace()}>Chọn project…</button>
        </div>

        {mode === 'code' && (
          <div className="quick-checks">
            <span className="eyebrow">QUICK CHECK</span>
            <div className="check-grid">
              {(['build', 'test', 'lint', 'typecheck'] as const).map((check) => (
                <button key={check} disabled={busy} onClick={() => void ask(`Hãy chạy ${check} cho project hiện tại, phân tích output và nói rõ lỗi cần sửa.`)}>{check}</button>
              ))}
            </div>
          </div>
        )}

        <div className="sidebar-footer">
          <button className={`voice-switch ${voiceEnabled ? 'on' : ''}`} onClick={() => setVoiceEnabled((v) => !v)}>
            <span>{voiceEnabled ? '🔊' : '🔇'}</span> Voice reply {voiceEnabled ? 'ON' : 'OFF'}
          </button>
          <small>Giọng nói phát ra là giọng AI.</small>
        </div>
      </aside>

      <main className="main-panel">
        <header className="topbar">
          <div>
            <span className="eyebrow">BÂU BOT / {modeTitle.toUpperCase()}</span>
            <h1>{mode === 'meeting' ? 'Meeting Assistant' : mode === 'code' ? 'Coding Agent' : 'Hỏi Bâu Bot'}</h1>
          </div>
          <div className={`status ${recording ? 'recording' : ''}`}><i /> {status}</div>
        </header>

        {mode === 'meeting' ? (
          <section className="meeting-layout">
            <div className="meeting-card">
              <div className="card-heading">
                <div><span className="eyebrow">TRANSCRIPT</span><h2>Transcript cuộc họp</h2></div>
                <button className="primary" disabled={busy || !meetingTranscript.trim()} onClick={() => void summarize()}>Tóm tắt</button>
              </div>
              <textarea className="transcript" value={meetingTranscript} onChange={(e) => setMeetingTranscript(e.target.value)} placeholder="Dán transcript hoặc dùng Ctrl+Space để thêm lời nói vào đây…" />
            </div>
            <div className="meeting-card summary-card">
              <span className="eyebrow">SUMMARY</span>
              <div className="summary-output">{meetingSummary || 'Bâu Bot sẽ tạo: Tóm tắt • Quyết định • Việc cần làm • Deadline • Câu hỏi còn mở'}</div>
            </div>
          </section>
        ) : mode === 'code' ? (
          <section className="coding-layout">
            <div className="coding-chat">{messageList}{composer}</div>
            <aside className="patch-panel">
              <div className="patch-heading">
                <div><span className="eyebrow">PATCH APPROVAL</span><h2>Thay đổi chờ duyệt</h2></div>
                <span className="count-badge">{proposals.length}</span>
              </div>
              {proposals.length === 0 ? (
                <div className="empty-patch">Khi Bâu Bot đề xuất sửa code, diff sẽ xuất hiện ở đây trước khi file được ghi.</div>
              ) : proposals.map((proposal) => (
                <article className="patch-card" key={proposal.id}>
                  <strong>{proposal.path}</strong>
                  <p>{proposal.summary}</p>
                  <pre>{proposal.diff}</pre>
                  <div className="patch-actions">
                    <button className="reject" disabled={busy} onClick={() => void discardProposal(proposal.id)}>Discard</button>
                    <button className="apply" disabled={busy} onClick={() => void applyProposal(proposal.id)}>Apply patch</button>
                  </div>
                </article>
              ))}
            </aside>
          </section>
        ) : (
          <>{messageList}{composer}</>
        )}
      </main>
    </div>
  )
}
