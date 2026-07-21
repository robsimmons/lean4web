import * as rpc from 'vscode-ws-jsonrpc'

const FILE_PROGRESS_METHOD = '$/lean/fileProgress'
const RPC_CALL_METHOD = '$/lean/rpc/call'
const SET_SERVER_MESSAGE_PRIORITIZATION_METHOD =
  '$/lean4web/setServerMessagePrioritization'
const HIGH_PRIORITY_RPC_METHODS = new Set([
  'Lean.Widget.getInteractiveGoals',
  'Lean.Widget.getInteractiveTermGoal',
  'Lean.Widget.getWidgets',
  'Lean.Widget.getInteractiveDiagnostics',
])

const hasOwn = (value, property) =>
  value !== null &&
  typeof value === 'object' &&
  Object.prototype.hasOwnProperty.call(value, property)

const combineEvents =
  (...events) =>
  (listener) => {
    const disposables = events.map((event) => event(listener))
    return {
      dispose: () => disposables.forEach((disposable) => disposable.dispose()),
    }
  }

export function createMergedMessageReader(readers) {
  return {
    onError: combineEvents(...readers.map((reader) => reader.onError)),
    onClose: combineEvents(...readers.map((reader) => reader.onClose)),
    onPartialMessage: combineEvents(
      ...readers.map((reader) => reader.onPartialMessage),
    ),
    listen: (callback) => {
      const disposables = readers.map((reader) => reader.listen(callback))
      return {
        dispose: () =>
          disposables.forEach((disposable) => disposable.dispose()),
      }
    },
    dispose: () => readers.forEach((reader) => reader.dispose()),
  }
}

function createFilteredMessageReader(reader, filterMessage) {
  return {
    onError: reader.onError,
    onClose: reader.onClose,
    onPartialMessage: reader.onPartialMessage,
    listen: (callback) =>
      reader.listen((message) => {
        if (filterMessage(message)) callback(message)
      }),
    dispose: () => reader.dispose(),
  }
}

/** Selects a channel for server-originated messages without request context. */
export function selectServerChannel(message) {
  if (message?.method === FILE_PROGRESS_METHOD) return 'hi'
  return 'lo'
}

/** Tracks the client requests whose otherwise-unmarked responses belong on hi. */
export function createServerChannelRouter() {
  const highPriorityResponseIds = new Set()
  let prioritizationEnabled = true

  return {
    filterClientMessage: (message) => {
      if (message?.method === SET_SERVER_MESSAGE_PRIORITIZATION_METHOD) {
        if (typeof message.params?.enabled === 'boolean') {
          prioritizationEnabled = message.params.enabled
          if (!prioritizationEnabled) highPriorityResponseIds.clear()
        }
        return false
      }

      if (
        prioritizationEnabled &&
        message?.method === RPC_CALL_METHOD &&
        HIGH_PRIORITY_RPC_METHODS.has(message.params?.method) &&
        hasOwn(message, 'id')
      ) {
        highPriorityResponseIds.add(message.id)
      }
      return true
    },
    selectServerChannel: (message) => {
      if (!prioritizationEnabled) return 'lo'

      const defaultChannel = selectServerChannel(message)
      if (defaultChannel === 'hi') return defaultChannel

      if (
        !hasOwn(message, 'method') &&
        hasOwn(message, 'id') &&
        highPriorityResponseIds.delete(message.id)
      ) {
        return 'hi'
      }
      return 'lo'
    },
  }
}

export function createChannelMessageWriter(
  writers,
  selectChannel = selectServerChannel,
) {
  return {
    onError: combineEvents(
      ...Object.values(writers).map((writer) => writer.onError),
    ),
    onClose: combineEvents(
      ...Object.values(writers).map((writer) => writer.onClose),
    ),
    write: (message) => {
      const channel = selectChannel(message)
      const writer = writers[channel]
      if (!writer) {
        return Promise.reject(
          new Error(`Selected unavailable LSP channel: ${channel}`),
        )
      }
      return writer.write(message)
    },
    end: () => Object.values(writers).forEach((writer) => writer.end()),
    dispose: () => Object.values(writers).forEach((writer) => writer.dispose()),
  }
}

const toRpcSocket = (ws) => ({
  send: (data) => ws.send(data),
  onMessage: (callback) => ws.on('message', callback),
  onError: (callback) => ws.on('error', callback),
  onClose: (callback) => ws.on('close', callback),
  dispose: () => ws.close(),
})

export function createLspWebSocketTransports(channels, selectChannel) {
  const channelReaders = Object.fromEntries(
    Object.entries(channels).map(([channel, ws]) => [
      channel,
      new rpc.WebSocketMessageReader(toRpcSocket(ws)),
    ]),
  )
  const channelWriters = Object.fromEntries(
    Object.entries(channels).map(([channel, ws]) => [
      channel,
      new rpc.WebSocketMessageWriter(toRpcSocket(ws)),
    ]),
  )
  const readers = Object.values(channelReaders)
  const combinedReader =
    readers.length === 1 ? readers[0] : createMergedMessageReader(readers)
  const router =
    selectChannel === undefined && channelWriters.hi
      ? createServerChannelRouter()
      : undefined
  const effectiveSelectChannel =
    selectChannel ?? router?.selectServerChannel ?? (() => 'lo')

  return {
    reader: router
      ? createFilteredMessageReader(combinedReader, router.filterClientMessage)
      : combinedReader,
    writer: createChannelMessageWriter(channelWriters, effectiveSelectChannel),
  }
}
