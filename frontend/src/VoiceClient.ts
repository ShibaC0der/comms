export type VoiceState =
  | { status: 'idle' | 'connecting' | 'connected' }
  | { status: 'error'; message: string }

const WELCOME_TIMEOUT_MS = 10_000

type Connection = {
  events: AbortController
  stream?: MediaStream
  socket?: WebSocket
  welcomeTimeout?: ReturnType<typeof setTimeout>
}

export class VoiceClient {
  private connection?: Connection

  constructor(private readonly onStateChange: (state: VoiceState) => void) {}

  async connect() {
    if (this.connection) return

    const connection: Connection = { events: new AbortController() }
    this.connection = connection
    this.onStateChange({ status: 'connecting' })

    if (!navigator.mediaDevices?.getUserMedia) {
      this.fail('Микрофон недоступен. Откройте страницу через HTTPS или localhost.')
      return
    }

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (error) {
      if (connection.events.signal.aborted) return
      this.fail(
        error instanceof DOMException && error.name === 'NotAllowedError'
          ? 'Доступ к микрофону запрещён.'
          : 'Не удалось получить доступ к микрофону. Проверьте устройство и настройки браузера.',
      )
      return
    }

    if (connection.events.signal.aborted) {
      stream.getTracks().forEach(track => track.stop())
      return
    }
    connection.stream = stream

    const options = { signal: connection.events.signal }
    const microphoneEnded = () => this.fail('Микрофон отключился. Проверьте устройство и подключитесь снова.')
    for (const track of stream.getAudioTracks()) {
      if (track.readyState === 'ended') {
        microphoneEnded()
        return
      }
      track.addEventListener('ended', microphoneEnded, options)
    }

    const url = new URL('/ws', location.href)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    try {
      connection.socket = new WebSocket(url)
    } catch {
      this.fail('Не удалось открыть соединение с сервером.')
      return
    }

    connection.welcomeTimeout = setTimeout(() => {
      this.fail('Сервер не подтвердил подключение. Попробуйте ещё раз.')
    }, WELCOME_TIMEOUT_MS)
    connection.socket.addEventListener('message', event => {
      try {
        if (JSON.parse(event.data)?.type === 'welcome') {
          clearTimeout(connection.welcomeTimeout)
          connection.welcomeTimeout = undefined
          this.onStateChange({ status: 'connected' })
        }
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error
      }
    }, options)
    connection.socket.addEventListener('error', () => {
      this.fail('Не удалось связаться с сервером.')
    }, options)
    connection.socket.addEventListener('close', () => {
      this.fail('Соединение с сервером закрыто.')
    }, options)
  }

  disconnect() {
    this.dispose()
    this.onStateChange({ status: 'idle' })
  }

  dispose() {
    const connection = this.connection
    if (!connection) return

    this.connection = undefined
    connection.events.abort()
    clearTimeout(connection.welcomeTimeout)
    connection.stream?.getTracks().forEach(track => track.stop())
    connection.socket?.close()
  }

  private fail(message: string) {
    this.dispose()
    this.onStateChange({ status: 'error', message })
  }
}
