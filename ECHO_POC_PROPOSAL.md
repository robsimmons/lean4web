# Proposal / PoC: `#echo` → browser `alert()` on end-of-elaboration

## Goal

When a user writes a file beginning with `import Echo` and containing one or more
`#echo "..."` commands, then **once the document finishes elaborating** they get a
browser `alert()` showing the echoed text. (Undefined behavior if the file has
elaboration errors — see caveats.)

This is a proof of concept demonstrating a general pattern: *get information out of
Lean elaboration and react to it in the browser, keyed off the
"document fully loaded" signal*, without modifying or rebuilding the Lean server.

## Architecture

The lean4web server (`server/index.mjs`) is a JSON-RPC proxy sitting between the
browser's WebSocket and a per-connection `lake serve` process. It already
eavesdrops on both directions of the stream. We use four small touch points:

```
  Browser                     server/index.mjs (proxy)              lake serve
  ───────                     ────────────────────────              ──────────
  echo-alert.ts                                                     Echo.lean
  (WebSocket tap)                                                   (#echo cmd)
       │                                                                 │
       │  didOpen/didChange ───────────►  track currentVersion ────────►│
       │                                  reset echoes=[]                │  elaborate
       │                                                                 │  #echo "x"
       │                                  publishDiagnostics  ◄──────────│  logInfo
       │                                  collect "#echo: x" → echoes    │  "#echo: x"
       │                                                                 │
       │                                  $/lean/fileProgress []  ◄──────│  done
       │                                  (load complete for version)    │
       │  $/echo/alert  ◄──── inject if echoes.length>0                  │
   alert("x")                                                            │
```

1. **`Projects/Stable/Echo.lean`** — defines the `#echo` command. `#echo "x"`
   logs `#echo: x` as an *information* diagnostic via `logInfoAt`. No Lean-server
   changes: the message rides out on the ordinary `textDocument/publishDiagnostics`
   notification, exactly like the output of `#check`.

2. **`Projects/Stable/lakefile.toml`** — adds an `Echo` `lean_lib` and includes it
   in `defaultTargets` so `leanweb-build.sh`'s `lake build` pre-builds it and
   `import Echo` resolves.

3. **`server/index.mjs`** (the proxy) — per connection:
   - tracks `currentVersion` from client→server `didOpen`/`didChange`;
   - collects `#echo: ` messages from server→client `publishDiagnostics` for that
     version (honoring Lean's incremental-diagnostics mode);
   - on the `$/lean/fileProgress` "done" signal (empty `processing`) for the
     current version, if any echoes were collected, **injects** a custom
     `$/echo/alert` notification onto the browser-bound socket.

4. **`client/src/echo-alert.ts`** — wraps the global `WebSocket` constructor and
   attaches a *passive* `message` listener to the `/websocket/` socket. When it
   sees `$/echo/alert`, it calls `window.alert(...)`. It never consumes or alters
   messages, so lean4monaco's language client is unaffected (it simply ignores the
   unknown notification). Installed via a side-effect import at the top of
   `client/src/index.tsx`, before lean4monaco opens its socket.

## Why this works (protocol facts)

Verified against `leanprover/lean4` `master`:

- **`#echo` output is a normal diagnostic.** `logInfo`/`logInfoAt` surface as
  information diagnostics through `textDocument/publishDiagnostics`, and
  `Diagnostic := DiagnosticWith String` with `message : String`
  (`src/Lean/Data/Lsp/Diagnostics.lean:142,156`) — so `d.message` is a plain
  string we can prefix-match.
- **Diagnostics can be incremental.** `PublishDiagnosticsParams.isIncremental?`
  ("append to the previous set rather than replacing it",
  `Diagnostics.lean:159-170`) is set to `some true` on follow-up publishes when the
  client advertises support (`src/Lean/Server/FileWorker/Diagnostics.lean:138-159`).
  The proxy therefore **appends** when `isIncremental === true` and **replaces**
  otherwise.
- **`$/lean/fileProgress` is the reliable "done" signal.** `LeanFileProgressParams`
  (`src/Lean/Data/Lsp/Extra.lean:96-99`); an empty `processing` array means the
  document version finished elaborating. Per `(uri, version)`; restarts on every
  edit — so we match against the current version and fire once.
- **Version is client-owned.** `didOpen` carries a mandatory
  `TextDocumentItem.version` (`Basic.lean:307`); `didChange` carries
  `VersionedTextDocumentIdentifier.version?` (`Basic.lean:147`). The server only
  echoes the version it is *processing*, which can lag, so the proxy reads the
  authoritative version from the client→server stream.

## How to test (manual)

1. Build the project so `import Echo` resolves:
   `cd Projects/Stable && lake build` (or run `leanweb-build.sh`).
2. Start the dev server + client as usual for lean4web.
3. Open the **Stable** project in the browser and enter:
   ```lean
   import Echo
   #echo "Hello from Lean!"
   ```
4. When elaboration finishes, a browser `alert()` should pop up reading
   `Hello from Lean!`. Multiple `#echo`s produce one alert with newline-separated
   lines. Server console logs `SERVER: Document load complete for <version>`.

> Note: this PoC has **not** been run end-to-end in this environment (no Lean
> toolchain / live web server here). The Lean module, lakefile, proxy logic, and
> client tap are written to be coherent, and `server/index.mjs` passes
> `node --check`, but a live smoke test is still needed.

## Caveats & limitations

- **Prefix matching is fragile.** Detection keys off the literal `#echo: ` prefix
  in the diagnostic message. A user info message starting with `#echo: ` would be a
  false positive. The non-fragile replacement is the proxy-side RPC route described
  under "Towards a non-fragile version" below — it does **not** require modifying
  the Lean server.
- **Elaboration errors ⇒ undefined behavior**, as requested. We fire on the empty
  `processing` "done" path; the `fatalError` path (a single `processing:[{kind:2}]`)
  is not handled, and a `#echo` after an error may or may not have elaborated.
- **Unknown notification noise.** The injected `$/echo/alert` reaches lean4monaco's
  language client too, which will log it as an unhandled notification. Harmless,
  but noisy; a production version might route it differently.
- **`alert()` is blocking/ugly** — fine for a PoC. Productionizing would use the
  infoview or a toast.
- **Argument is a string literal only.** `#echo` currently accepts `str`. Echoing
  arbitrary terms/expressions would need real elaboration of the argument.
- **Diagnostic/progress ordering (handled).** The `#echo` diagnostic and the empty
  `fileProgress` race, and the order flips between initial load and edits: on load
  the diagnostic lands first; on an edit Lean reuses the snapshot, so the empty
  `fileProgress` lands first and the diagnostic trails it. The proxy therefore
  doesn't treat `fileProgress`-done as the sole trigger — `maybeFireEcho()` fires
  when *both* "elaboration complete" and "≥1 echo collected" hold (whichever lands
  last), guarded by `firedVersion` so it fires exactly once per version.

## Towards a non-fragile version (chosen forward path: proxy-side RPC)

The plan is to replace the `#echo: ` string-matching with **structured** data over
a custom RPC method, pulled by the proxy. This needs **no Lean-server modification**;
a native server→client push notification (which *would* require forking `src/`) is
**out of scope**.

Shape:

1. **`Echo.lean` (downstream).** Register a request handler with
   `@[server_rpc_method]` (registration is environment-extension based —
   `RequestHandling.lean:26,115-139` — so it takes effect simply by the user file
   doing `import Echo`; no `builtin_initialize`, no rebuild). `#echo "x"` stashes
   its payload during elaboration (e.g. an environment extension, or an InfoTree
   `CustomInfo` leaf) so the handler can return the file's echoes as structured
   data instead of a logged string.
2. **Proxy (`server/index.mjs`).** Keep the existing `$/lean/fileProgress`-done
   trigger and version tracking. On "done", instead of scraping diagnostics, the
   proxy issues `$/lean/rpc/connect` then `$/lean/rpc/call` (method = the registered
   name) toward `lake serve`, reads the structured echoes from the response, and
   injects `$/echo/alert` to the browser exactly as today.
3. **Client tap.** Unchanged.

Open issues to settle when prototyping the proxy side:
- **JSON-RPC id hygiene:** the proxy must mint its own request ids that can't
  collide with the client's (e.g. string ids like `"echo-1"`).
- **Response suppression:** responses to the proxy's *own* rpc requests must be
  consumed, not forwarded to the browser as spurious replies — verify whether
  returning a falsy value from the `forward` map fn actually drops the message.
- **RPC session lifetime:** `rpc/connect` yields a `sessionId`; consider keepalive
  / reconnect, though for a single collect-on-done call it can be short-lived.

## Files changed

- `Projects/Stable/Echo.lean` (new) — the `#echo` command.
- `Projects/Stable/lakefile.toml` — add `Echo` lib + default target.
- `server/index.mjs` — per-connection echo collection, race-tolerant
  `maybeFireEcho()` + `$/echo/alert` injection. (Retains `[echo]` debug logging.)
- `client/src/echo-alert.ts` (new) — passive WebSocket tap → `alert()`.
- `client/src/index.tsx` — side-effect import of the tap.
