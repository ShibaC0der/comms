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

const nameKey = 'comms.displayName'

function readSavedName() {
  try { return localStorage.getItem(nameKey)?.trim() ?? '' } catch { return '' }
}

export default function App() {
  const [savedName, setSavedName] = useState(readSavedName)
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [nameError, setNameError] = useState('')
  const [selfId, setSelfId] = useState('')
  const [members, setMembers] = useState(new Map<string, string>())
  const [state, setState] = useState<VoiceState>({ status: 'idle' })
  const [diagnostics, setDiagnostics] = useState<VoiceDiagnostics>({ socket: 'closed', peers: [] })
  const [remoteAudio, setRemoteAudio] = useState(() => new Map<string, MediaStream>())
  const clientRef = useRef<VoiceClient | null>(null)

  useEffect(() => {
    const syncName = (event: StorageEvent) => {
      if (event.key === nameKey || event.key === null) setSavedName(readSavedName())
    }
    window.addEventListener('storage', syncName)
    const client = new VoiceClient(state => {
      setState(state)
      if (state.status === 'error') setSaving(false)
    }, (id, stream) => {
      if (clientRef.current !== client) return
      setRemoteAudio(previous => {
        const next = new Map(previous)
        if (stream) next.set(id, stream)
        else next.delete(id)
        return next
      })
    }, (id, members) => {
      setSelfId(id)
      setMembers(members)
    }, name => {
      setSavedName(name)
      setEditing(false)
      setSaving(false)
      setNameError('')
      try { localStorage.setItem(nameKey, name) } catch {
        setNameError('Браузер не смог сохранить имя для следующего входа.')
      }
    }, message => {
      setNameError(message)
      setSaving(false)
    }, diagnostics => {
      if (clientRef.current === client) setDiagnostics(diagnostics)
    })
    clientRef.current = client
    return () => {
      window.removeEventListener('storage', syncName)
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
      {active ? (
        <button type="button" onClick={() => {
          if (saving) setNameError('Смена имени не подтверждена.')
          setSaving(false)
          clientRef.current?.disconnect()
        }}>Отключиться</button>
      ) : (
        <form onSubmit={event => {
          event.preventDefault()
          setNameError('')
          const name = readSavedName() || savedName || draft.trim()
          if (!name) { setNameError('Введите имя участника.'); return }
          void clientRef.current?.connect(name)
        }}>
          {!savedName && <label>Ваше имя <input value={draft} onChange={event => setDraft(event.target.value)} required /></label>}
          <button type="submit">Подключиться</button>
        </form>
      )}
      {nameError && <p role="alert">{nameError}</p>}
      {state.status === 'connected' && (
        <section aria-label="Участники">
          <h2>Участники</h2>
          <ul>
            {Array.from(members, ([id, name]) => (
              <li key={id}>
                {name}
                {id === selfId && (editing ? (
                  <form onSubmit={event => {
                    event.preventDefault()
                    if (!draft.trim()) { setNameError('Введите имя участника.'); return }
                    setNameError('')
                    setSaving(true)
                    clientRef.current?.rename(draft)
                  }}>
                    <label>Новое имя <input autoFocus required disabled={saving} value={draft} onChange={event => setDraft(event.target.value)} /></label>
                    <button disabled={saving}>Сохранить</button>
                    <button type="button" disabled={saving} onClick={() => { setEditing(false); setNameError('') }}>Отмена</button>
                  </form>
                ) : (
                  <button type="button" onClick={() => { setDraft(name); setEditing(true) }}>Изменить имя</button>
                ))}
              </li>
            ))}
          </ul>
        </section>
      )}
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
