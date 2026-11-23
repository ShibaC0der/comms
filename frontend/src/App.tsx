import { useEffect, useRef, useState } from 'react'
import { VoiceClient, type VoiceState } from './VoiceClient'

const statusLabel: Record<VoiceState['status'], string> = {
  idle: 'Не подключено',
  connecting: 'Подключение…',
  connected: 'Подключено',
  error: 'Ошибка подключения',
}

export default function App() {
  const [state, setState] = useState<VoiceState>({ status: 'idle' })
  const clientRef = useRef<VoiceClient | null>(null)

  useEffect(() => {
    const client = new VoiceClient(setState)
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
    </main>
  )
}
