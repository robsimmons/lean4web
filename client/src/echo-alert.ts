/**
 * `#echo` proof-of-concept — browser side.
 *
 * The lean4web server proxy (`server/index.mjs`) injects a custom
 * `$/echo/alert` notification onto the LSP websocket once a document that
 * contains `#echo "..."` commands has finished elaborating. lean4monaco owns
 * that websocket, so we don't have a handle on it directly; instead we wrap the
 * global `WebSocket` constructor and attach a *passive* `message` listener to
 * any socket opened against `/websocket/`. We never consume or alter messages,
 * so the language client keeps working normally — it just ignores the unknown
 * `$/echo/alert` notification.
 *
 * Importing this module for its side effect installs the wrapper. It must run
 * before lean4monaco opens its socket, so import it at the top of the entry
 * point (`index.tsx`).
 */
const NativeWebSocket = window.WebSocket

console.debug('[echo] websocket tap installed')

class EchoObservingWebSocket extends NativeWebSocket {
  constructor(url: string | URL, protocols?: string | string[]) {
    super(url, protocols)
    const href = typeof url === 'string' ? url : url.toString()
    console.debug('[echo] WebSocket constructed:', href)
    if (!href.includes('/websocket/')) return
    console.debug('[echo] observing LSP websocket:', href)

    let loggedFirst = false
    this.addEventListener('message', (event: MessageEvent) => {
      if (typeof event.data !== 'string') return
      let msg: any
      try {
        msg = JSON.parse(event.data)
      } catch {
        return // not JSON: not ours
      }
      if (!loggedFirst) {
        loggedFirst = true
        console.debug('[echo] first LSP message seen, method =', msg?.method)
      }
      if (msg?.method !== '$/echo/alert') return
      console.debug('[echo] $/echo/alert received:', msg.params)
      const messages: string[] = msg.params?.messages ?? []
      const hasErrors: boolean = msg.params?.hasErrors ?? false
      if (messages.length > 0) {
        const text =
          messages.join('\n') + (hasErrors ? '\n\n(compiled with errors)' : '')
        window.alert(text)
      }
    })
  }
}

window.WebSocket = EchoObservingWebSocket as unknown as typeof WebSocket
