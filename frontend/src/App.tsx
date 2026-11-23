import { useEffect, useRef, useState } from 'react'
import { VoiceClient, type VoiceState } from './VoiceClient'

const statusLabel: Record<VoiceState['status'], string> = {
  idle: 'Не подключено',
  connecting: 'Подключение…',
  connected: 'Подключено',
  error: 'Ошибка подключения',
}

function RemoteAudio({ stream }: { stream: MediaStream }) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [playbackBlocked, setPlaybackBlocked] = useState(false)

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    let active = true
    audio.srcObject = stream
    void audio.play().catch(() => {
      if (active) setPlaybackBlocked(true)
    })
    return () => {
      active = false
      audio.pause()
      audio.srcObject = null
    }
  }, [stream])

  return (
    <div>
      <audio ref={audioRef} onPlaying={() => setPlaybackBlocked(false)} />
      {playbackBlocked && (
        <button type="button" onClick={() => {
          void audioRef.current?.play().catch(() => setPlaybackBlocked(true))
        }}>
          Включить звук
        </button>
      )}
    </div>
  )
}

export default function App() {
  const [state, setState] = useState<VoiceState>({ status: 'idle' })
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
      {[...remoteAudio].map(([id, stream]) => <RemoteAudio key={id} stream={stream} />)}
    </main>
  )
}
