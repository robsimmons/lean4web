import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'

import {
  LspSessionCoordinator,
  parseLspWebSocketRequest,
} from './lsp-sessions.mjs'
import { createLspWebSocketTransports } from './lsp-transports.mjs'

class FakeSocket extends EventEmitter {
  readyState = 1
  closes = []
  sent = []

  send(message) {
    this.sent.push(message)
  }

  close(code, reason) {
    if (this.readyState > 1) return
    this.readyState = 3
    this.closes.push({ code, reason })
    this.emit('close', code, reason)
  }
}

const sessionId = '0123456789abcdef0123456789abcdef'

test('merges both inbound channels and sends server messages on lo', async () => {
  const hi = new FakeSocket()
  const lo = new FakeSocket()
  const { reader, writer } = createLspWebSocketTransports({ hi, lo })
  const received = []
  reader.listen((message) => received.push(message))

  hi.emit('message', JSON.stringify({ jsonrpc: '2.0', method: 'from-hi' }))
  lo.emit('message', JSON.stringify({ jsonrpc: '2.0', method: 'from-lo' }))
  assert.deepEqual(
    received.map((message) => message.method),
    ['from-hi', 'from-lo'],
  )

  await writer.write({ jsonrpc: '2.0', method: 'server-message' })
  assert.equal(hi.sent.length, 0)
  assert.equal(lo.sent.length, 1)
  assert.equal(JSON.parse(lo.sent[0]).method, 'server-message')
  reader.dispose()
  writer.dispose()
})

test('channel writer keeps hi and lo sends on independent sockets', async () => {
  const hi = new FakeSocket()
  const lo = new FakeSocket()
  const { writer } = createLspWebSocketTransports({ hi, lo }, (message) =>
    message.method === 'urgent' ? 'hi' : 'lo',
  )

  await Promise.all([
    writer.write({ jsonrpc: '2.0', method: 'bulk' }),
    writer.write({ jsonrpc: '2.0', method: 'urgent' }),
  ])
  assert.equal(JSON.parse(lo.sent[0]).method, 'bulk')
  assert.equal(JSON.parse(hi.sent[0]).method, 'urgent')
  writer.dispose()
})

test('legacy transport continues to read and write one socket', async () => {
  const socket = new FakeSocket()
  const { reader, writer } = createLspWebSocketTransports({ lo: socket })
  let received
  reader.listen((message) => (received = message))

  socket.emit('message', JSON.stringify({ jsonrpc: '2.0', method: 'legacy' }))
  await writer.write({ jsonrpc: '2.0', method: 'legacy-response' })
  assert.equal(received.method, 'legacy')
  assert.equal(JSON.parse(socket.sent[0]).method, 'legacy-response')
  reader.dispose()
  writer.dispose()
})

test('parses legacy and paired LSP URLs and rejects malformed channels', () => {
  assert.deepEqual(parseLspWebSocketRequest('/websocket/Stable'), {
    kind: 'legacy',
    project: 'Stable',
  })
  assert.deepEqual(
    parseLspWebSocketRequest(
      `/websocket/Stable?session=${sessionId}&channel=hi`,
    ),
    { kind: 'dual', project: 'Stable', sessionId, channel: 'hi' },
  )
  assert.equal(
    parseLspWebSocketRequest(`/websocket/Stable?session=short&channel=hi`).kind,
    'invalid',
  )
  assert.equal(
    parseLspWebSocketRequest(
      `/websocket/Stable?session=${sessionId}&channel=medium`,
    ).kind,
    'invalid',
  )
  assert.equal(
    parseLspWebSocketRequest(
      `/websocket/Stable?session=${sessionId}&channel=lo&extra=true`,
    ).kind,
    'invalid',
  )
})

test('starts one logical session only after both channels attach', () => {
  let starts = 0
  const coordinator = new LspSessionCoordinator({
    startSession: ({ channels }) => {
      starts += 1
      assert.ok(channels.hi)
      assert.ok(channels.lo)
      return { dispose() {} }
    },
  })

  coordinator.attach({
    project: 'Stable',
    sessionId,
    channel: 'hi',
    socket: new FakeSocket(),
  })
  assert.equal(starts, 0)
  coordinator.attach({
    project: 'Stable',
    sessionId,
    channel: 'lo',
    socket: new FakeSocket(),
  })
  assert.equal(starts, 1)
  assert.equal(coordinator.activeSessionCount, 1)
  coordinator.dispose()
})

test('rejects duplicate attachment without replacing the paired session', () => {
  let starts = 0
  const coordinator = new LspSessionCoordinator({
    startSession: () => {
      starts += 1
      return { dispose() {} }
    },
  })
  coordinator.attach({
    project: 'Stable',
    sessionId,
    channel: 'hi',
    socket: new FakeSocket(),
  })
  coordinator.attach({
    project: 'Stable',
    sessionId,
    channel: 'lo',
    socket: new FakeSocket(),
  })

  const duplicate = new FakeSocket()
  assert.equal(
    coordinator.attach({
      project: 'Stable',
      sessionId,
      channel: 'lo',
      socket: duplicate,
    }),
    false,
  )
  assert.equal(duplicate.closes[0].code, 1008)
  assert.equal(starts, 1)
  assert.equal(coordinator.activeSessionCount, 1)
  coordinator.dispose()
})

test('closing either channel closes its peer and disposes the process transport', () => {
  const hi = new FakeSocket()
  const lo = new FakeSocket()
  let disposed = 0
  let sessionsClosed = 0
  const coordinator = new LspSessionCoordinator({
    startSession: () => ({ dispose: () => (disposed += 1) }),
    onSessionClosed: () => (sessionsClosed += 1),
  })
  coordinator.attach({
    project: 'Stable',
    sessionId,
    channel: 'hi',
    socket: hi,
  })
  coordinator.attach({
    project: 'Stable',
    sessionId,
    channel: 'lo',
    socket: lo,
  })

  hi.close(1000, 'test close')
  assert.equal(lo.readyState, 3)
  assert.equal(disposed, 1)
  assert.equal(sessionsClosed, 1)
  assert.equal(coordinator.activeSessionCount, 0)
})

test('expires a half-open session', async () => {
  const hi = new FakeSocket()
  let starts = 0
  const coordinator = new LspSessionCoordinator({
    startupTimeoutMs: 5,
    startSession: () => {
      starts += 1
      return { dispose() {} }
    },
  })
  coordinator.attach({
    project: 'Stable',
    sessionId,
    channel: 'hi',
    socket: hi,
  })

  await delay(20)
  assert.equal(starts, 0)
  assert.equal(hi.readyState, 3)
  assert.equal(coordinator.activeSessionCount, 0)
})

test('process exit cleanup allows a fresh session with the same ID', () => {
  let starts = 0
  let closeFirstSession
  const coordinator = new LspSessionCoordinator({
    startSession: ({ close }) => {
      starts += 1
      closeFirstSession ??= close
      return { dispose() {} }
    },
  })
  const attachPair = () => {
    coordinator.attach({
      project: 'Stable',
      sessionId,
      channel: 'hi',
      socket: new FakeSocket(),
    })
    coordinator.attach({
      project: 'Stable',
      sessionId,
      channel: 'lo',
      socket: new FakeSocket(),
    })
  }

  attachPair()
  closeFirstSession(1011, 'process exited')
  attachPair()
  assert.equal(starts, 2)
  coordinator.dispose()
})
