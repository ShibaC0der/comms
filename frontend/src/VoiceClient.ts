type Participant = { peerId: string; displayName: string }

export type VoiceState =
  | { status: 'idle' | 'connecting' | 'connected' }
  | { status: 'error'; message: string }

export type VoiceDiagnostics = {
  socket: 'closed' | 'connecting' | 'open'
  peers: {
    id: string
    connection: RTCPeerConnectionState
    ice: RTCIceConnectionState
  }[]
}

const WELCOME_TIMEOUT_MS = 10_000

type Signal =
  | { type: 'description'; description: RTCSessionDescriptionInit }
  | { type: 'candidate'; candidate: RTCIceCandidateInit }

type ServerMessage =
  | { type: 'welcome'; selfId: string; displayName: string; peers: Participant[] }
  | ({ type: 'peer-joined' | 'peer-renamed' } & Participant)
  | { type: 'error'; message: string }
  | { type: 'peer-left'; peerId: string }
  | { type: 'signal'; from: string; data: Signal }

type Peer = {
  events: AbortController
  pc: RTCPeerConnection
  candidates: RTCIceCandidateInit[]
  pending: Promise<void>
}

type Connection = {
  events: AbortController
  selfId?: string
  members: Map<string, string>
  peers: Map<string, Peer>
  socketState: VoiceDiagnostics['socket']
  stream?: MediaStream
  socket?: WebSocket
  welcomeTimeout?: ReturnType<typeof setTimeout>
}

export class VoiceClient {
  private connection?: Connection

  constructor(
    private readonly onStateChange: (state: VoiceState) => void,
    private readonly onRemoteAudio: (id: string, stream: MediaStream | null) => void,
    private readonly onMembers: (selfId: string, members: Map<string, string>) => void,
    private readonly onConfirmedName: (name: string) => void,
    private readonly onNameError: (message: string) => void,
    private readonly onDiagnostics: (diagnostics: VoiceDiagnostics) => void,
  ) {}

  async connect(displayName: string) {
    if (this.connection) return

    const connection: Connection = { events: new AbortController(), members: new Map(), peers: new Map(), socketState: 'closed' }
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

    connection.socketState = 'connecting'
    this.reportSocket(connection)
    connection.socket.addEventListener('open', () => {
      connection.socket!.send(JSON.stringify({ type: 'join', displayName }))
      connection.socketState = 'open'
      this.reportSocket(connection)
    }, options)
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
      console.debug('[Comms] welcome', { peers: message.peers.length })
      this.onStateChange({ status: 'connected' })
      connection.selfId = message.selfId
      connection.members.set(message.selfId, message.displayName)
      for (const { peerId, displayName } of message.peers) connection.members.set(peerId, displayName)
      this.onMembers(message.selfId, new Map(connection.members))
      this.onConfirmedName(message.displayName)
      for (const { peerId: id } of message.peers) {
        const peer = this.addPeer(connection, stream, id)
        this.queueNegotiation(connection, id, peer, async () => {
          await peer.pc.setLocalDescription(await peer.pc.createOffer())
          this.sendDescription(connection, id, peer)
        })
      }
    } else if (message.type === 'error') {
      if (connection.selfId) this.onNameError(message.message)
      else this.fail(message.message)
    } else if (!connection.selfId) {
      return
    } else if (message.type === 'peer-joined' || message.type === 'peer-renamed') {
      connection.members.set(message.peerId, message.displayName)
      this.onMembers(connection.selfId, new Map(connection.members))
      if (message.type === 'peer-joined') this.addPeer(connection, stream, message.peerId)
      else if (message.peerId === connection.selfId) this.onConfirmedName(message.displayName)
    } else if (message.type === 'peer-left') {
      connection.members.delete(message.peerId)
      this.onMembers(connection.selfId, new Map(connection.members))
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
    const peer: Peer = { events: new AbortController(), pc, candidates: [], pending: Promise.resolve() }
    connection.peers.set(id, peer)

    const options = { signal: peer.events.signal }
    const reportState = () => {
      console.debug('[Comms] peer state', id, pc.connectionState, pc.iceConnectionState)
      this.reportDiagnostics()
    }
    pc.addEventListener('connectionstatechange', reportState, options)
    pc.addEventListener('iceconnectionstatechange', reportState, options)
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
    reportState()
    return peer
  }

  private queueNegotiation(connection: Connection, id: string, peer: Peer, operation: () => Promise<void>) {
    // WebSocket messages arrive in order, but WebRTC operations finish asynchronously.
    peer.pending = peer.pending.then(async () => {
      if (connection.peers.get(id) === peer) await operation()
    }).catch(() => {
      if (connection.peers.get(id) !== peer) return
      this.removePeer(connection, id)
      console.warn('[Comms] negotiation failed', id)
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
    peer.events.abort()
    peer.pc.close()
    console.debug('[Comms] peer closed', id)
    if (this.connection === connection) this.reportDiagnostics()
    this.onRemoteAudio(id, null)
  }

  rename(displayName: string) {
    const socket = this.connection?.socket
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'rename', displayName }))
    } else {
      this.fail('Соединение с сервером закрыто.')
    }
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
    connection.socketState = 'closed'
    this.reportSocket(connection)
  }

  private reportSocket(connection: Connection) {
    console.debug('[Comms] WebSocket', connection.socketState)
    this.reportDiagnostics()
  }

  private reportDiagnostics() {
    this.onDiagnostics({
      socket: this.connection?.socketState ?? 'closed',
      peers: Array.from(this.connection?.peers ?? [], ([id, { pc }]) => ({
        id,
        connection: pc.connectionState,
        ice: pc.iceConnectionState,
      })),
    })
  }

  private fail(message: string) {
    this.dispose()
    this.onStateChange({ status: 'error', message })
  }
}
