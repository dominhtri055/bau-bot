import { useCallback, useEffect, useRef, useState } from 'react'

type Props = {
  onStatusChange: (status: string) => void
  onRecordingChange: (recording: boolean) => void
}

type MeetingListItem = {
  id: string
  title: string
  startedAt: string
  endedAt: string | null
  durationMs: number | null
  status: 'recording' | 'completed'
  chunkCount: number
  transcriptPreview: string
  summaryPreview: string
}

type StoredMeeting = {
  id: string
  title: string
  startedAt: string
  endedAt: string | null
  durationMs: number | null
  status: 'recording' | 'completed'
  chunkCount: number
  transcript: string
  summary: string
  capture: {
    microphone: boolean
    systemAudio: boolean
  }
}

const CHUNK_MS = 120_000

function formatDuration(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = seconds % 60
  return [hours, minutes, secs].map((value) => String(value).padStart(2, '0')).join(':')
}

function preferredMimeType() {
  const choices = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
  ]
  return choices.find((type) => MediaRecorder.isTypeSupported(type)) || ''
}

function extensionForMime(mimeType: string) {
  if (mimeType.includes('ogg')) return 'ogg'
  return 'webm'
}

export default function MeetingPanel({ onStatusChange, onRecordingChange }: Props) {
  const [title, setTitle] = useState('')
  const [recording, setRecording] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [meetingId, setMeetingId] = useState<string | null>(null)
  const [transcript, setTranscript] = useState('')
  const [summary, setSummary] = useState('')
  const [systemAudio, setSystemAudio] = useState(false)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [startedAtMs, setStartedAtMs] = useState(0)
  const [history, setHistory] = useState<MeetingListItem[]>([])
  const [historyQuery, setHistoryQuery] = useState('')
  const [selectedMeetingId, setSelectedMeetingId] = useState<string | null>(null)
  const [error, setError] = useState('')

  const activeRef = useRef(false)
  const meetingIdRef = useRef<string | null>(null)
  const startedAtRef = useRef(0)
  const chunkIndexRef = useRef(0)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunkTimerRef = useRef<number | null>(null)
  const streamsRef = useRef<MediaStream[]>([])
  const audioContextRef = useRef<AudioContext | null>(null)
  const queueRef = useRef<Promise<void>>(Promise.resolve())

  const refreshHistory = useCallback(async (query = '') => {
    try {
      setHistory(await window.bau.listMeetings(query))
    } catch (historyError) {
      console.error(historyError)
    }
  }, [])

  useEffect(() => {
    void refreshHistory()
  }, [refreshHistory])

  useEffect(() => {
    const timer = window.setTimeout(() => void refreshHistory(historyQuery), 180)
    return () => window.clearTimeout(timer)
  }, [historyQuery, refreshHistory])

  useEffect(() => {
    if (!recording) return
    const timer = window.setInterval(() => {
      setElapsedMs(Date.now() - startedAtMs)
    }, 1000)
    return () => window.clearInterval(timer)
  }, [recording, startedAtMs])

  const enqueueChunk = useCallback((
    blob: Blob,
    chunkIndex: number,
    offsetMs: number,
    mimeType: string,
  ) => {
    const currentMeetingId = meetingIdRef.current
    if (!currentMeetingId || blob.size < 512) return

    queueRef.current = queueRef.current
      .catch(() => undefined)
      .then(async () => {
        setProcessing(true)
        onStatusChange(`Đang transcribe chunk ${chunkIndex + 1}…`)
        try {
          const result = await window.bau.transcribeMeetingChunk({
            id: currentMeetingId,
            bytes: await blob.arrayBuffer(),
            extension: extensionForMime(mimeType),
            chunkIndex,
            offsetMs,
          })
          setTranscript(result.transcript)
          setError('')
          onStatusChange(
            result.diarized
              ? `Đã nhận dạng chunk ${chunkIndex + 1} + speaker`
              : `Đã nhận dạng chunk ${chunkIndex + 1} (không diarize)`,
          )
        } catch (chunkError) {
          const message = chunkError instanceof Error ? chunkError.message : String(chunkError)
          setError(`Chunk ${chunkIndex + 1}: ${message}. Audio vẫn được lưu local trước khi transcribe.`)
          onStatusChange('Có chunk chưa transcribe được')
        } finally {
          setProcessing(false)
        }
      })
  }, [onStatusChange])

  const recordNextChunk = useCallback((stream: MediaStream) => {
    if (!activeRef.current) return

    const mimeType = preferredMimeType()
    const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)
    const parts: Blob[] = []
    const chunkIndex = chunkIndexRef.current++
    const offsetMs = Math.max(0, Date.now() - startedAtRef.current)
    recorderRef.current = recorder

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) parts.push(event.data)
    }

    recorder.onstop = () => {
      if (chunkTimerRef.current !== null) {
        window.clearTimeout(chunkTimerRef.current)
        chunkTimerRef.current = null
      }

      const blob = new Blob(parts, { type: recorder.mimeType || mimeType || 'audio/webm' })
      enqueueChunk(blob, chunkIndex, offsetMs, recorder.mimeType || mimeType)

      if (activeRef.current) recordNextChunk(stream)
    }

    recorder.start()
    chunkTimerRef.current = window.setTimeout(() => {
      if (recorder.state === 'recording') recorder.stop()
    }, CHUNK_MS)
  }, [enqueueChunk])

  const cleanupCapture = useCallback(async () => {
    streamsRef.current.forEach((stream) => {
      stream.getTracks().forEach((track) => track.stop())
    })
    streamsRef.current = []

    if (audioContextRef.current) {
      await audioContextRef.current.close().catch(() => undefined)
      audioContextRef.current = null
    }
  }, [])

  const startMeeting = useCallback(async () => {
    if (activeRef.current || processing) return

    setError('')
    setTranscript('')
    setSummary('')
    setElapsedMs(0)
    onStatusChange('Đang mở microphone + system audio…')

    let micStream: MediaStream | null = null
    let displayStream: MediaStream | null = null
    let audioContext: AudioContext | null = null

    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })

      try {
        displayStream = await navigator.mediaDevices.getDisplayMedia({
          audio: true,
          video: true,
        })
      } catch (displayError) {
        console.warn('System audio unavailable, continuing with microphone only.', displayError)
      }

      const hasSystemAudio = Boolean(displayStream?.getAudioTracks().length)
      audioContext = new AudioContext()
      await audioContext.resume()
      const destination = audioContext.createMediaStreamDestination()

      const micSource = audioContext.createMediaStreamSource(
        new MediaStream(micStream.getAudioTracks()),
      )
      micSource.connect(destination)

      if (hasSystemAudio && displayStream) {
        const systemSource = audioContext.createMediaStreamSource(
          new MediaStream(displayStream.getAudioTracks()),
        )
        systemSource.connect(destination)
      }

      const combinedStream = new MediaStream(destination.stream.getAudioTracks())
      if (!combinedStream.getAudioTracks().length) throw new Error('Không tạo được audio stream.')

      const stored = await window.bau.startMeeting({
        title: title.trim() || undefined,
        capture: {
          microphone: true,
          systemAudio: hasSystemAudio,
        },
      })

      const now = Date.now()
      meetingIdRef.current = stored.id
      startedAtRef.current = now
      chunkIndexRef.current = 0
      activeRef.current = true
      queueRef.current = Promise.resolve()
      streamsRef.current = [micStream, ...(displayStream ? [displayStream] : [])]
      audioContextRef.current = audioContext

      setMeetingId(stored.id)
      setSelectedMeetingId(stored.id)
      setStartedAtMs(now)
      setSystemAudio(hasSystemAudio)
      setRecording(true)
      onRecordingChange(true)
      onStatusChange(
        hasSystemAudio
          ? 'Đang ghi: microphone + âm thanh Windows'
          : 'Đang ghi: microphone (system audio chưa có)',
      )

      displayStream?.getVideoTracks().forEach((track) => {
        track.addEventListener('ended', () => {
          if (activeRef.current) {
            setSystemAudio(false)
            onStatusChange('System capture đã dừng; microphone vẫn đang ghi')
          }
        })
      })

      recordNextChunk(combinedStream)
    } catch (startError) {
      micStream?.getTracks().forEach((track) => track.stop())
      displayStream?.getTracks().forEach((track) => track.stop())
      await audioContext?.close().catch(() => undefined)

      const message = startError instanceof Error ? startError.message : String(startError)
      setError(message)
      onStatusChange('Không bắt đầu được meeting')
      setRecording(false)
      onRecordingChange(false)
    }
  }, [onRecordingChange, onStatusChange, processing, recordNextChunk, title])

  const stopMeeting = useCallback(async () => {
    if (!activeRef.current) return

    activeRef.current = false
    setRecording(false)
    onRecordingChange(false)
    onStatusChange('Đang đóng chunk cuối…')

    if (chunkTimerRef.current !== null) {
      window.clearTimeout(chunkTimerRef.current)
      chunkTimerRef.current = null
    }

    const recorder = recorderRef.current
    if (recorder && recorder.state !== 'inactive') {
      await new Promise<void>((resolve) => {
        recorder.addEventListener('stop', () => resolve(), { once: true })
        recorder.stop()
      })
    }

    await cleanupCapture()

    setProcessing(true)
    onStatusChange('Đang hoàn tất transcript…')
    try {
      await queueRef.current
      const id = meetingIdRef.current
      if (!id) throw new Error('Không tìm thấy meeting id.')

      onStatusChange('Đang tạo meeting summary…')
      const saved = await window.bau.finishMeeting(id)
      setTranscript(saved.transcript)
      setSummary(saved.summary)
      setSelectedMeetingId(saved.id)
      setElapsedMs(saved.durationMs || Date.now() - startedAtRef.current)
      await refreshHistory(historyQuery)
      onStatusChange('Meeting đã lưu')
    } catch (finishError) {
      const message = finishError instanceof Error ? finishError.message : String(finishError)
      setError(message)
      onStatusChange('Meeting đã dừng nhưng chưa hoàn tất summary')
    } finally {
      setProcessing(false)
      meetingIdRef.current = null
      recorderRef.current = null
    }
  }, [cleanupCapture, historyQuery, onRecordingChange, onStatusChange, refreshHistory])

  useEffect(() => {
    return window.bau.onVoiceToggle(() => {
      if (activeRef.current) void stopMeeting()
      else void startMeeting()
    })
  }, [startMeeting, stopMeeting])

  const manualSummarize = async () => {
    if (!transcript.trim() || processing || recording) return
    setProcessing(true)
    onStatusChange('Đang tóm tắt transcript…')
    try {
      setSummary(await window.bau.summarizeMeeting(transcript))
      onStatusChange('Đã tóm tắt transcript')
    } catch (summaryError) {
      setError(summaryError instanceof Error ? summaryError.message : String(summaryError))
      onStatusChange('Không tóm tắt được')
    } finally {
      setProcessing(false)
    }
  }

  const openHistoryMeeting = async (id: string) => {
    if (recording) return
    setProcessing(true)
    onStatusChange('Đang mở meeting…')
    try {
      const saved: StoredMeeting = await window.bau.getMeeting(id)
      setSelectedMeetingId(saved.id)
      setMeetingId(saved.id)
      setTitle(saved.title)
      setTranscript(saved.transcript)
      setSummary(saved.summary)
      setSystemAudio(saved.capture.systemAudio)
      setElapsedMs(saved.durationMs || 0)
      setError('')
      onStatusChange('Đã mở meeting')
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError))
      onStatusChange('Không mở được meeting')
    } finally {
      setProcessing(false)
    }
  }

  return (
    <section className="meeting-v3-layout">
      <div className="meeting-card meeting-live-card">
        <div className="meeting-recorder-head">
          <div>
            <span className="eyebrow">LIVE MEETING</span>
            <h2>{recording ? 'Đang ghi cuộc họp' : 'Meeting recorder'}</h2>
          </div>
          <div className="meeting-timer">{formatDuration(elapsedMs)}</div>
        </div>

        <div className="meeting-title-row">
          <input
            value={title}
            disabled={recording}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Tên cuộc họp (không bắt buộc)"
          />
          <button
            className={recording ? 'danger meeting-record-button' : 'primary meeting-record-button'}
            disabled={processing && !recording}
            onClick={() => recording ? void stopMeeting() : void startMeeting()}
          >
            {recording ? '■ Stop & summarize' : '● Start meeting'}
          </button>
        </div>

        <div className="capture-badges">
          <span className={recording ? 'capture-badge active' : 'capture-badge'}>🎙 Microphone</span>
          <span className={systemAudio ? 'capture-badge active' : 'capture-badge'}>
            🖥 System audio {systemAudio ? 'ON' : 'OFF'}
          </span>
          <span className="capture-badge">2 min / chunk</span>
          {meetingId && <span className="capture-badge id-badge" title={meetingId}>Saved local</span>}
        </div>

        {error && <div className="meeting-error">{error}</div>}

        <div className="transcript-heading">
          <div>
            <span className="eyebrow">DIARIZED TRANSCRIPT</span>
            <small>Speaker labels trong mỗi chunk do transcription model nhận dạng.</small>
          </div>
          <button
            className="subtle inline-button"
            disabled={processing || recording || !transcript.trim()}
            onClick={() => void manualSummarize()}
          >
            Tóm tắt lại
          </button>
        </div>

        <textarea
          className="transcript meeting-transcript"
          value={transcript}
          readOnly={recording}
          onChange={(event) => setTranscript(event.target.value)}
          placeholder="Nhấn Start meeting. Bâu Bot sẽ ghi microphone + âm thanh Windows và transcript tự xuất hiện theo từng chunk."
        />

        <div className="meeting-footnote">
          <span><kbd>Ctrl</kbd> + <kbd>Space</kbd> {recording ? 'dừng meeting' : 'bắt đầu meeting'}</span>
          {processing && <span className="processing-dot">Đang xử lý audio…</span>}
        </div>
      </div>

      <div className="meeting-side-stack">
        <div className="meeting-card meeting-summary-card">
          <div className="card-heading">
            <div>
              <span className="eyebrow">MEETING SUMMARY</span>
              <h2>Tóm tắt & action items</h2>
            </div>
          </div>
          <div className="summary-output">
            {summary || 'Sau khi dừng recording, Bâu Bot sẽ tự tạo Tóm tắt • Quyết định • Việc cần làm • Deadline • Câu hỏi còn mở.'}
          </div>
        </div>

        <div className="meeting-card meeting-history-card">
          <div className="history-heading">
            <div>
              <span className="eyebrow">LOCAL HISTORY</span>
              <h2>Cuộc họp đã lưu</h2>
            </div>
            <span className="count-badge">{history.length}</span>
          </div>

          <input
            className="meeting-search"
            value={historyQuery}
            onChange={(event) => setHistoryQuery(event.target.value)}
            placeholder="Tìm title, transcript, summary…"
          />

          <div className="meeting-history-list">
            {history.length === 0 ? (
              <div className="empty-patch">Chưa có meeting nào được lưu.</div>
            ) : history.map((item) => (
              <button
                key={item.id}
                className={selectedMeetingId === item.id ? 'meeting-history-item active' : 'meeting-history-item'}
                disabled={recording}
                onClick={() => void openHistoryMeeting(item.id)}
              >
                <strong>{item.title}</strong>
                <span>{new Date(item.startedAt).toLocaleString()} · {formatDuration(item.durationMs || 0)}</span>
                <p>{item.summaryPreview || item.transcriptPreview || 'Chưa có transcript.'}</p>
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
