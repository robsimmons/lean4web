const PROJECT_PATTERN = /^[A-Za-z][A-Za-z0-9._-]*$/
const SESSION_PATTERN = /^[A-Za-z0-9_-]{16,128}$/
const CHANNELS = new Set(['hi', 'lo'])

export function parseLspWebSocketRequest(requestUrl) {
  const parsed = new URL(requestUrl, 'ws://localhost')
  const match = /^\/websocket\/([\w.-]+)$/.exec(parsed.pathname)
  if (!match) return null

  const project = match[1]
  if (!PROJECT_PATTERN.test(project)) {
    return { kind: 'invalid', reason: 'invalid project name' }
  }

  if (parsed.search === '') {
    return { kind: 'legacy', project }
  }

  const sessionValues = parsed.searchParams.getAll('session')
  const channelValues = parsed.searchParams.getAll('channel')
  const keys = [...parsed.searchParams.keys()]
  if (
    sessionValues.length !== 1 ||
    channelValues.length !== 1 ||
    keys.some((key) => key !== 'session' && key !== 'channel')
  ) {
    return { kind: 'invalid', reason: 'invalid channel parameters' }
  }

  const sessionId = sessionValues[0]
  const channel = channelValues[0]
  if (!SESSION_PATTERN.test(sessionId)) {
    return { kind: 'invalid', reason: 'invalid session ID' }
  }
  if (!CHANNELS.has(channel)) {
    return { kind: 'invalid', reason: 'invalid channel name' }
  }

  return { kind: 'dual', project, sessionId, channel }
}

const closeSocket = (socket, code, reason) => {
  if (socket.readyState !== 0 && socket.readyState !== 1) return
  try {
    socket.close(code, reason)
  } catch {
    // The peer may have closed between the readyState check and close().
  }
}

/** Coordinates the two physical WebSockets belonging to one LSP session. */
export class LspSessionCoordinator {
  constructor({
    startSession,
    startupTimeoutMs = 10_000,
    onSessionStarted = () => {},
    onSessionClosed = () => {},
  }) {
    this.startSession = startSession
    this.startupTimeoutMs = startupTimeoutMs
    this.onSessionStarted = onSessionStarted
    this.onSessionClosed = onSessionClosed
    this.sessions = new Map()
  }

  get activeSessionCount() {
    return this.sessions.size
  }

  attach({ project, sessionId, channel, socket }) {
    if (
      !PROJECT_PATTERN.test(project) ||
      !SESSION_PATTERN.test(sessionId) ||
      !CHANNELS.has(channel)
    ) {
      closeSocket(socket, 1008, 'Invalid LSP session')
      return false
    }

    const key = `${project}\0${sessionId}`
    let session = this.sessions.get(key)
    if (!session) {
      session = {
        key,
        project,
        sessionId,
        channels: {},
        closed: false,
        started: false,
        transport: undefined,
        timer: undefined,
      }
      session.timer = setTimeout(
        () => this.close(session, 1008, 'LSP channel pairing timed out'),
        this.startupTimeoutMs,
      )
      session.timer.unref?.()
      this.sessions.set(key, session)
    }

    if (session.channels[channel]) {
      closeSocket(socket, 1008, `Duplicate ${channel} channel`)
      return false
    }

    session.channels[channel] = socket
    socket.once('error', () =>
      this.close(session, 1011, `LSP ${channel} channel failed`),
    )
    socket.once('close', () =>
      this.close(session, 1000, `LSP ${channel} channel closed`),
    )

    if (session.channels.hi && session.channels.lo) {
      clearTimeout(session.timer)
      session.timer = undefined
      try {
        const transport = this.startSession({
          project,
          sessionId,
          channels: session.channels,
          close: (code = 1011, reason = 'LSP session ended') =>
            this.close(session, code, reason),
        })
        if (session.closed) {
          transport?.dispose?.()
        } else {
          session.transport = transport
          session.started = true
          this.onSessionStarted({ project, sessionId })
        }
      } catch (error) {
        this.close(session, 1011, 'Failed to start Lean server')
        throw error
      }
    }

    return true
  }

  close(session, code = 1000, reason = 'LSP session closed') {
    if (session.closed) return
    session.closed = true
    clearTimeout(session.timer)
    if (this.sessions.get(session.key) === session) {
      this.sessions.delete(session.key)
    }

    for (const socket of Object.values(session.channels)) {
      closeSocket(socket, code, reason)
    }
    session.transport?.dispose?.()
    if (session.started) {
      this.onSessionClosed({
        project: session.project,
        sessionId: session.sessionId,
      })
    }
  }

  dispose() {
    for (const session of [...this.sessions.values()]) {
      this.close(session, 1001, 'Server shutting down')
    }
  }
}
