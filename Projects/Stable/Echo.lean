import Lean

/-!
# `#echo` — proof-of-concept command for lean4web

`#echo "x"` stamps a structured `EchoInfo` marker into the `InfoTree` during
elaboration. It emits **no diagnostic** — no infoview message, no editor squiggle.

The marker is read by the `@[server_rpc_method] Echo.collect` handler below, which
walks the document's info trees and returns every `#echo` payload as data — no
string matching. Both the command and the RPC handler are ordinary user-space
code: registering the RPC method only requires the user file to `import Echo`; the
Lean server itself is unmodified (`@[server_rpc_method]` registration is
environment-extension based, so it travels in via the import).

## How the proxy calls this

RPC is client-pull, so the proxy drives it on the `$/lean/fileProgress`-done
trigger by sending, over the same LSP socket to `lake serve`:

1. `$/lean/rpc/connect`  params `{ "uri": <fileUri> }`            -> `{ "sessionId": <UInt64> }`
2. `$/lean/rpc/call`     params `{ "textDocument": { "uri": <fileUri> },
                                    "position": { "line": 0, "character": 0 },
                                    "sessionId": <UInt64>,
                                    "method": "Echo.collect",
                                    "params": {} }`
   -> result `{ "messages": ["x", ...] }`

(The `position` only needs to land inside the elaborated document so the worker
resolves a snapshot whose environment imported `Echo`; (0,0) is fine.)
-/

open Lean Elab Command Server RequestM

/-- Structured payload stamped into the `InfoTree` for each `#echo`. -/
structure EchoInfo where
  message : String
  deriving TypeName

/-- `#echo "some text"` — echo a string literal to the browser. -/
syntax (name := echoCmd) "#echo " str : command

@[command_elab echoCmd]
def elabEchoCmd : CommandElab := fun stx => do
  let some msg := stx[1].isStrLit? | throwErrorAt stx "#echo expects a string literal"
  -- Stamp a structured marker into the `InfoTree` for the RPC path. This emits no
  -- diagnostic, so `#echo` shows no infoview message and no editor squiggle.
  pushInfoLeaf <| .ofCustomInfo { stx := stx[1], value := Dynamic.mk (EchoInfo.mk msg) }

/-! ## RPC: collect every `#echo` in the document as structured data -/

/-- Parameters for `Echo.collect`. No inputs needed — the worker already knows
which document it serves (`readDoc`). `RpcEncodable` comes for free via the
`[FromJson] [ToJson] => RpcEncodable` instance. -/
structure EchoParams where
  deriving FromJson, ToJson

/-- Result of `Echo.collect`: the `#echo` messages (in document order) and whether
the document elaborated with any errors. -/
structure EchoResult where
  messages : Array String
  hasErrors : Bool
  deriving FromJson, ToJson

/-- Pull every `EchoInfo` marker out of one info tree. -/
def collectEchoes (tree : InfoTree) : List String :=
  tree.collectNodesBottomUp fun _ctx info _children acc =>
    match info with
    | .ofCustomInfo ci =>
      match ci.value.get? EchoInfo with
      | some e => e.message :: acc
      | none   => acc
    | _ => acc

/-- `Echo.collect` RPC method: returns every `#echo` payload in the file.
Registered downstream via `@[server_rpc_method]`, so it is available in any
worker whose document `import`s `Echo`. -/
@[server_rpc_method]
def Echo.collect (_ : EchoParams) : RequestM (RequestTask EchoResult) := do
  let doc ← readDoc
  -- `waitAll` resolves once every command snapshot is elaborated, which is
  -- exactly the state the proxy calls us in (after `$/lean/fileProgress` empty).
  let t := doc.cmdSnaps.waitAll
  mapTaskCostly t fun (snaps, _) => do
    let messages := snaps.foldl (init := #[]) fun acc snap =>
      acc ++ (collectEchoes snap.infoTree).toArray
    -- `MessageLog.hasErrors` is exactly what drives the editor's error squiggles.
    let hasErrors := snaps.any (·.msgLog.hasErrors)
    return { messages, hasErrors }
