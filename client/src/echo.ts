/**
 * `#echo` proof of concept — fully client-side.
 *
 * `Projects/Stable/Echo.lean` registers an `@[server_rpc_method] Echo.collect`
 * (it travels in via `import Echo`, no Lean-server fork) that returns the file's
 * `#echo "..."` payloads as structured data. Rather than having the lean4web
 * server proxy watch the stream and inject a notification, we do the whole thing
 * from the browser through lean4monaco's public client surface:
 *
 *   1. observe the "document finished elaborating" signal via
 *      `LeanClient.progressChanged` (empty `processing` array for a URI);
 *   2. then issue `$/lean/rpc/connect` + `$/lean/rpc/call Echo.collect` with
 *      `LeanClient.sendRequest`, exactly the request shape the infoview uses;
 *   3. surface the result with `window.alert`.
 *
 * The proxy stays a plain JSON-RPC pass-through — it no longer knows anything
 * about `#echo`. The RPC round-trips through it like any other LSP traffic, so
 * its generic URI rewriting addresses the document for `lake serve` the same way
 * `didOpen` does; we simply reuse the URI `progressChanged` hands us.
 */
import type { LeanClient, LeanMonaco } from 'lean4monaco'

/**
 * Coalesce the post-`progressChanged` pull: `$/lean/fileProgress` can report an
 * empty `processing` array more than once per elaboration (the double-empty on
 * edits), so we wait a beat and pull once per quiet settle.
 */
const ECHO_DEBOUNCE_MS = 300

interface Disposable {
  dispose(): void
}

/**
 * Wire the `#echo` observer onto a started `LeanMonaco` instance. Returns a
 * disposable that tears down every subscription and pending timer; call it from
 * the editor effect's cleanup.
 */
export function installEchoObserver(leanMonaco: LeanMonaco): Disposable {
  const subscriptions: Disposable[] = []
  // Per-URI: `armed` flips true while a version is elaborating, so an empty
  // `processing` only fires a pull if elaboration was actually in flight (this
  // also dedups the double-empty). `timers` debounces that pull.
  const armed = new Map<string, boolean>()
  const timers = new Map<string, ReturnType<typeof setTimeout>>()

  const register = (client: LeanClient) => {
    subscriptions.push(
      client.progressChanged(([uri, processing]: [string, unknown[]]) => {
        if (processing.length > 0) {
          armed.set(uri, true)
          return
        }
        // `processing` is empty: this version finished elaborating.
        if (!armed.get(uri)) return
        armed.set(uri, false)

        const pending = timers.get(uri)
        if (pending) clearTimeout(pending)
        timers.set(
          uri,
          setTimeout(() => {
            timers.delete(uri)
            void collectAndAlert(client, uri)
          }, ECHO_DEBOUNCE_MS),
        )
      }),
    )
  }

  leanMonaco.clientProvider?.getClients().forEach(register)
  if (leanMonaco.clientProvider) {
    subscriptions.push(leanMonaco.clientProvider.clientAdded(register))
  }

  return {
    dispose() {
      timers.forEach((t) => clearTimeout(t))
      timers.clear()
      subscriptions.forEach((d) => d.dispose())
    },
  }
}

/**
 * Pull the file's `#echo`s for `uri` over RPC and alert. `Echo.collect` returns
 * plain data (no `WithRpcRef`), so the session is just a ticket for the call: we
 * connect, call immediately, and let the empty session self-expire. If the file
 * didn't `import Echo`, the call rejects with "unknown method" and we stay quiet.
 */
async function collectAndAlert(client: LeanClient, uri: string): Promise<void> {
  try {
    const { sessionId } = await client.sendRequest('$/lean/rpc/connect', { uri })
    const result = await client.sendRequest('$/lean/rpc/call', {
      textDocument: { uri },
      position: { line: 0, character: 0 },
      sessionId,
      method: 'Echo.collect',
      params: {},
    })
    const messages: string[] = result?.messages ?? []
    const hasErrors: boolean = result?.hasErrors ?? false
    if (messages.length > 0) {
      window.alert(
        messages.join('\n') + (hasErrors ? '\n\n(compiled with errors)' : ''),
      )
    }
  } catch (e) {
    // No `Echo.collect` in this file (didn't `import Echo`), or the session
    // raced an edit. Either way there's nothing to surface.
    console.debug('[echo] collect skipped:', e)
  }
}
