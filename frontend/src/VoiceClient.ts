export type VoiceState =
  | { status: 'idle' | 'connecting' | 'connected' }
  | { status: 'error'; message: string }

const WELCOME_TIMEOUT_MS = 10_000

type Signal =
  | { type: 'description'; description: RTCSessionDescriptionInit }
  | { type: 'candidate'; candidate: RTCIceCandidateInit }

type ServerMessage =
  | { type: 'welcome'; peers: string[] }
  | { type: 'peer-joined' | 'peer-left'; peerId: string }
  | { type: 'signal'; from: string; data: Signal }

type Peer = {
  pc: RTCPeerConnection
  candidates: RTCIceCandidateInit[]
  pending: Promise<void>
}

type Connection = {
  events: AbortController
  peers: Map<string, Peer>
  stream?: MediaStream
  socket?: WebSocket
  welcomeTimeout?: ReturnType<typeof setTimeout>
}

export class VoiceClient {
  private connection?: Connection

  constructor(
    private readonly onStateChange: (state: VoiceState) => void,
    private readonly onRemoteAudio: (id: string, stream: MediaStream | null) => void,
  ) {}

  async connect() {
    if (this.connection) return

    const connection: Connection = { events: new AbortController(), peers: new Map() }
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
      let message: ServerMessage | null
      try {
        message = JSON.parse(event.data)
      } catch {
        return
      }
      if (message) this.handleMessage(connection, stream, message)
    }, options)
    connection.socket.addEventListener('error', () => {
      this.fail('Не удалось связаться с сервером.')
    }, options)
    connection.socket.addEventListener('close', () => {
      this.fail('Соединение с сервером закрыто.')
    }, options)
  }

  private handleMessage(connection: Connection, stream: MediaStream, message: ServerMessage) {
    if (message.type === 'welcome' && connection.welcomeTimeout !== undefined) {
      if (!Array.isArray(message.peers)) return
      clearTimeout(connection.welcomeTimeout)
      connection.welcomeTimeout = undefined
      this.onStateChange({ status: 'connected' })
      for (const id of message.peers) {
        const peer = this.addPeer(connection, stream, id)
        this.queueNegotiation(connection, id, peer, async () => {
          await peer.pc.setLocalDescription(await peer.pc.createOffer())
          this.sendDescription(connection, id, peer)
        })
      }
    } else if (message.type === 'peer-joined') {
      this.addPeer(connection, stream, message.peerId)
    } else if (message.type === 'peer-left') {
      this.removePeer(connection, message.peerId)
    } else if (message.type === 'signal') {
      const peer = connection.peers.get(message.from)
      if (peer) {
        this.queueNegotiation(connection, message.from, peer, () => this.receiveSignal(connection, message.from, peer, message.data))
      }
    }
  }

  private addPeer(connection: Connection, stream: MediaStream, id: string) {
    const existing = connection.peers.get(id)
    if (existing) return existing

    const pc = new RTCPeerConnection()
    const peer: Peer = { pc, candidates: [], pending: Promise.resolve() }
    connection.peers.set(id, peer)

    const options = { signal: connection.events.signal }
    pc.addEventListener('icecandidate', ({ candidate }) => {
      if (candidate) this.sendSignal(connection, id, peer, { type: 'candidate', candidate: candidate.toJSON() })
    }, options)
    pc.addEventListener('track', ({ streams, track }) => {
      if (connection.peers.get(id) === peer) {
        this.onRemoteAudio(id, streams[0] ?? new MediaStream([track]))
      }
    }, options)

    const [track] = stream.getAudioTracks()
    pc.addTrack(track, stream)
    return peer
  }

  private queueNegotiation(connection: Connection, id: string, peer: Peer, operation: () => Promise<void>) {
    // WebSocket messages arrive in order, but WebRTC operations finish asynchronously.
    peer.pending = peer.pending.then(async () => {
      if (connection.peers.get(id) === peer) await operation()
    }).catch(() => {
      if (connection.peers.get(id) !== peer) return
      this.removePeer(connection, id)
      console.warn('Не удалось установить аудиосвязь с участником.')
    })
  }

  private async receiveSignal(connection: Connection, id: string, peer: Peer, signal: Signal) {
    const { pc, candidates } = peer
    if (signal.type === 'candidate') {
      if (pc.remoteDescription) await pc.addIceCandidate(signal.candidate)
      else candidates.push(signal.candidate)
      return
    }

    await pc.setRemoteDescription(signal.description)
    for (const candidate of candidates.splice(0)) {
      await pc.addIceCandidate(candidate)
    }
    if (signal.description.type === 'offer') {
      await pc.setLocalDescription(await pc.createAnswer())
      this.sendDescription(connection, id, peer)
    }
  }

  private sendDescription(connection: Connection, id: string, peer: Peer) {
    const description = peer.pc.localDescription
    if (description) {
      this.sendSignal(connection, id, peer, { type: 'description', description: description.toJSON() })
    }
  }

  private sendSignal(connection: Connection, id: string, peer: Peer, data: Signal) {
    const socket = connection.socket
    if (socket?.readyState === WebSocket.OPEN && connection.peers.get(id) === peer) {
      socket.send(JSON.stringify({ type: 'signal', to: id, data }))
    }
  }

  private removePeer(connection: Connection, id: string) {
    const peer = connection.peers.get(id)
    if (!peer) return

    connection.peers.delete(id)
    peer.pc.close()
    this.onRemoteAudio(id, null)
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
    for (const id of connection.peers.keys()) this.removePeer(connection, id)
    connection.stream?.getTracks().forEach(track => track.stop())
    connection.socket?.close()
  }

  private fail(message: string) {
    this.dispose()
    this.onStateChange({ status: 'error', message })
  }
}
