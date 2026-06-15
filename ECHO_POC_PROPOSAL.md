# Proposal / PoC: `#echo` → browser `alert()` on end-of-elaboration

## Goal

When a user writes a file beginning with `import Echo` and containing one or more
`#echo "..."` commands, then **once the document finishes elaborating** they get a
browser `alert()` showing the echoed text. (Undefined behavior if the file has
elaboration errors — see caveats.)

This demonstrates a general pattern: *get structured information out of Lean
elaboration and react to it in the browser, keyed off the "document fully loaded"
signal*, **without modifying or rebuilding the Lean server**.

Status: **working** end-to-end on a live demo server. The Lean-side `@[server_rpc_method]`
travels in via `import Echo`; the proxy pulls the data over RPC and injects a
notification the browser surfaces as `alert()`.

## Architecture

The lean4web server (`server/index.mjs`) is a JSON-RPC proxy between the browser's
WebSocket and a per-connection `lake serve` process. The `#echo` payload is read as
**structured data over a custom RPC method** — no diagnostic string-matching.

```
  Browser                    server/index.mjs (proxy)               lake serve
  ───────                    ────────────────────────               ──────────
  echo-alert.ts                                                     Echo.lean
  (WebSocket tap)                                                   #echo / Echo.collect
       │                                                                 │
       │  didOpen/didChange ──────────►  track currentVersion ──────────►│ elaborate
       │                                                                 │ #echo "x" stamps
       │                                                                 │ EchoInfo into InfoTree
       │                                 $/lean/fileProgress []  ◄────────│ done
       │                                 (debounced ≤1 / 4000ms)         │
       │                                 rpc/connect ───────────────────►│
       │                                 rpc/call Echo.collect ─────────►│ walk InfoTrees
       │                                 result {messages} ◄─────────────│ → ["x", ...]
       │  $/echo/alert  ◄──── inject if messages.length>0                │
   alert("x")                                                            │
```

Four touch points:

1. **`Projects/Stable/Echo.lean`** — `#echo "x"` stamps a structured `EchoInfo`
   marker into the `InfoTree` (`pushInfoLeaf <| .ofCustomInfo …`). It emits **no
   diagnostic** — no infoview message, no editor squiggle. The
   `@[server_rpc_method] Echo.collect` handler walks the document's info trees and
   returns every payload as `{ messages : Array String }`.

2. **`Projects/Stable/lakefile.toml`** — adds an `Echo` `lean_lib` in
   `defaultTargets` so `leanweb-build.sh`'s `lake build` pre-builds it and
   `import Echo` resolves.

3. **`server/index.mjs`** (the proxy) — per connection:
   - tracks `currentVersion` from client→server `didOpen`/`didChange`;
   - on the `$/lean/fileProgress` "done" signal (empty `processing`) for the
     current version, schedules a **debounced** check (≤1 per 4000 ms);
   - the check issues `$/lean/rpc/connect` then `$/lean/rpc/call Echo.collect`
     toward `lake serve`, and if the result is non-empty **injects** a custom
     `$/echo/alert` notification onto the browser-bound socket.

4. **`client/src/echo-alert.ts`** — wraps the global `WebSocket` constructor and
   attaches a *passive* `message` listener to the `/websocket/` socket. On
   `$/echo/alert` it calls `window.alert(...)`. It never consumes or alters
   messages, so lean4monaco's language client is unaffected (it ignores the unknown
   notification). Installed via a side-effect import at the top of
   `client/src/index.tsx`, before lean4monaco opens its socket.

## Why this works (verified against lean4 source; Lean-side pinned to `v4.29.0`)

- **`@[server_rpc_method]` needs no server fork.** Registration is
  environment-extension based: the attribute does `setEnv <| userRpcProcedures.insert …`
  (`Server/Rpc/RequestHandling.lean:26,115-139`), and dispatch looks the method up
  in the elaborated document's `snap.env` (`:61-63`). So `import Echo` makes
  `Echo.collect` available in that worker — no `builtin_initialize`, no rebuild.
- **Structured payload, no string matching.** `#echo` stamps a `CustomInfo`
  (`Elab/InfoTree/Types.lean:164`) carrying `EchoInfo` (a `Dynamic`, via
  `deriving TypeName`); `CommandElabM` has `MonadInfoTree` (`Elab/Command.lean:112`)
  so `pushInfoLeaf` works. `Echo.collect` reads it with `InfoTree.collectNodesBottomUp`
  (`Server/InfoUtils.lean:82`) over `doc.cmdSnaps.waitAll` (which resolves once every
  command snapshot is elaborated). Plain `Array String` result is `RpcEncodable` for
  free via `[FromJson][ToJson] ⇒ RpcEncodable` (`Server/Rpc/Basic.lean:173`).
- **`$/lean/fileProgress` is the reliable "done" trigger.** `LeanFileProgressParams`
  (`Data/Lsp/Extra.lean:96-99`); empty `processing` = that version finished. Per
  `(uri, version)`, restarts on every edit — so we match the current version.
- **Version is client-owned.** `didOpen` carries a mandatory `TextDocumentItem.version`
  (`Basic.lean:307`); `didChange` carries `VersionedTextDocumentIdentifier.version?`
  (`Basic.lean:147`). The server only echoes the version it is *processing* (can
  lag), so the proxy reads the authoritative version from the client→server stream.

## Proxy mechanics (the fiddly bits)

- **Manual `reader.listen` to swallow our own replies.** `vscode-ws-jsonrpc`'s
  `forward(to, map)` *always* does `to.writer.write(map(input))`, so it cannot drop
  a message. We therefore replaced `serverConnection.forward(socketConnection, …)`
  with `serverConnection.reader.listen(…)`: responses whose `id` is in our
  `pendingRpc` map are resolved and **not** forwarded; everything else is written to
  `socketConnection.writer`.
- **Id hygiene.** Our injected requests use string ids (`echo-N`); the browser uses
  numeric ids, so `pendingRpc.has(message.id)` can't false-match.
- **URI form.** We capture the server-side URI from `fileProgress` *before*
  `FilenamesToUri` rewrites it, so the RPC addresses the document the way
  `lake serve` names it (the RPC bypasses `urisToFilenames`).
- **Connect-fresh-per-trigger (no keepAlive).** RPC sessions exist for distributed
  GC of `WithRpcRef` objects, and expire after `keepAliveTimeMs = 30000`
  (`Server/FileWorker/Utils.lean:83`), refreshed by `$/lean/rpc/keepAlive`; an
  expired session makes `rpc/call` throw `rpcNeedsReconnect` (`FileWorker.lean:~789`).
  But `Echo.collect` returns plain data with **no references**, so the session is
  just a ticket for the call. We `connect` → `call` back-to-back and let the empty
  session self-expire — no caching, no keepAlive heartbeat.
- **Debounce.** The "done" trigger schedules a check at most once per 4000 ms
  (`scheduleEchoCheck`): the first completion after a quiet gap runs immediately; a
  burst of completions (rapid edits, the double empty-`processing`) coalesces into a
  single trailing check that reads the latest version. `firedVersion` guards against
  duplicate alerts; the pending timer is cleared on socket close.

## How to test (manual)

1. Build so `import Echo` resolves: `cd Projects/Stable && lake build` (or run
   `leanweb-build.sh`).
2. Start the dev server + client as usual.
3. Open the **Stable** project and enter:
   ```lean
   import Echo
   #echo "Hello from Lean!"
   ```
4. When elaboration finishes, a browser `alert()` reads `Hello from Lean!`. Multiple
   `#echo`s give one alert, newline-separated. The server console shows
   `SERVER: Document load complete for <v>` then `[echo] Echo.collect(v=<v>) -> [...]`,
   at most once per 4 s.

## Caveats & limitations

- **Re-fires per version.** The alert fires once per *document version*, and every
  settled edit is a new version — so editing a file that still contains `#echo "Bob"`
  re-alerts "Bob". This matches the "on document finish loading" goal, but a
  content-level dedup (only alert when the echo *set* changes) would be friendlier.
- **Elaboration errors ⇒ undefined behavior**, as requested. We fire on the empty
  `processing` "done" path; the `fatalError` path (`processing:[{kind:2}]`) is not
  handled.
- **`position: {0,0}`** in the RPC call assumes the header snapshot's env has `Echo`
  imported (it does — imports elaborate first). If `Echo.collect` ever returns
  "unknown method", use a position deeper in the file.
- **Unknown notification noise.** The injected `$/echo/alert` reaches lean4monaco's
  language client too, which logs it as unhandled. Harmless but noisy.
- **`alert()` is blocking/ugly** — fine for a PoC; productionize with the infoview or
  a toast.
- **Argument is a string literal only.** `#echo` accepts `str`; echoing arbitrary
  terms would need real elaboration of the argument.
- **Out of scope:** a *native* server→client push notification (which would delete
  the proxy/`fileProgress` scaffolding) — that one genuinely requires forking `src/`.
- **Debug logging.** `server/index.mjs` retains `[echo]` console logging for now.

## Files changed

- `Projects/Stable/Echo.lean` (new) — `#echo` command (InfoTree marker, no
  diagnostic) + `@[server_rpc_method] Echo.collect`.
- `Projects/Stable/lakefile.toml` — add `Echo` lib + default target.
- `server/index.mjs` — manual `reader.listen` server→client path; debounced,
  connect-fresh `Echo.collect` RPC pull on `fileProgress`-done; `$/echo/alert`
  injection. (Retains `[echo]` debug logging.)
- `client/src/echo-alert.ts` (new) — passive WebSocket tap → `alert()`.
- `client/src/index.tsx` — side-effect import of the tap.
