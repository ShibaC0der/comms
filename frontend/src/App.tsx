import { useEffect, useRef, useState } from 'react'
import { VoiceClient, type VoiceDiagnostics, type VoiceState } from './VoiceClient'

const statusLabel: Record<VoiceState['status'], string> = {
  idle: 'Не подключено',
  connecting: 'Подключение…',
  connected: 'Подключено',
  error: 'Ошибка подключения',
}

function playbackError(error: unknown) {
  if (error instanceof DOMException && error.name === 'NotAllowedError') {
    return 'Браузер заблокировал автоматическое воспроизведение.'
  }
  if (error instanceof DOMException && error.name === 'NotSupportedError') {
    return 'Браузер не поддерживает этот аудиопоток.'
  }
  return 'Не удалось воспроизвести аудиопоток.'
}

function RemoteAudio({ stream }: { stream: MediaStream }) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    let active = true
    setError(null)
    audio.srcObject = stream
    void audio.play().catch(error => {
      if (active) setError(playbackError(error))
    })
    return () => {
      active = false
      audio.pause()
      audio.srcObject = null
    }
  }, [stream])

  return (
    <div>
      <audio ref={audioRef} onPlaying={() => setError(null)} />
      {error && (
        <>
          <p role="alert">{error}</p>
          <button type="button" onClick={() => {
            void audioRef.current?.play().catch(error => setError(playbackError(error)))
          }}>
            Включить звук
          </button>
        </>
      )}
    </div>
  )
}

export default function App() {
  const [state, setState] = useState<VoiceState>({ status: 'idle' })
  const [diagnostics, setDiagnostics] = useState<VoiceDiagnostics>({ socket: 'closed', peers: [] })
  const [remoteAudio, setRemoteAudio] = useState(() => new Map<string, MediaStream>())
  const clientRef = useRef<VoiceClient | null>(null)

  useEffect(() => {
    const client = new VoiceClient(setState, (id, stream) => {
      if (clientRef.current !== client) return
      setRemoteAudio(previous => {
        const next = new Map(previous)
        if (stream) next.set(id, stream)
        else next.delete(id)
        return next
      })
    }, diagnostics => {
      if (clientRef.current === client) setDiagnostics(diagnostics)
    })
    clientRef.current = client
    return () => {
      clientRef.current = null
      client.dispose()
    }
  }, [])

  const active = state.status === 'connecting' || state.status === 'connected'

  return (
    <main className="app">
      <h1>Comms</h1>
      <p>Голосовой чат для друзей</p>
      <p className="muted" role="status">{statusLabel[state.status]}</p>
      {state.status === 'error' && <p role="alert">{state.message}</p>}
      <button
        type="button"
        onClick={() => {
          if (active) clientRef.current?.disconnect()
          else void clientRef.current?.connect()
        }}
      >
        {active ? 'Отключиться' : 'Подключиться'}
      </button>
      <section aria-label="Диагностика">
        <p>WebSocket: {diagnostics.socket}</p>
        <p>Собеседников: {diagnostics.peers.length}</p>
        {diagnostics.peers.length > 0 && (
          <ul>
            {diagnostics.peers.map(({ id, connection, ice }) => {
              const stream = remoteAudio.get(id)
              return (
                <li key={id}>
                  <div>{id}</div>
                  <div>connectionState: {connection}</div>
                  <div>iceConnectionState: {ice}</div>
                  {stream && <RemoteAudio stream={stream} />}
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </main>
  )
}
