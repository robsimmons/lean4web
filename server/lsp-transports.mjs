import * as rpc from 'vscode-ws-jsonrpc'

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

/** Central selection point for future server-originated message priority. */
export function selectServerChannel(_message) {
  return 'lo'
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

export function createLspWebSocketTransports(
  channels,
  selectChannel = selectServerChannel,
) {
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
  return {
    reader:
      readers.length === 1 ? readers[0] : createMergedMessageReader(readers),
    writer: createChannelMessageWriter(channelWriters, selectChannel),
  }
}
