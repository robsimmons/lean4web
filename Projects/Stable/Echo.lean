import Lean

/-!
# `#echo` — a proof-of-concept command for lean4web

`#echo "some text"` logs `some text` as an information message, tagged with a
`#echo: ` marker. The lean4web server proxy (`server/index.mjs`) watches the LSP
stream for that marker and, once the document has finished elaborating, asks the
browser to surface the collected messages via `alert()`.

This needs no changes to the Lean server itself: `#echo` is ordinary user-space
metaprogramming, and the message rides out on the existing
`textDocument/publishDiagnostics` notification — exactly like the output of
`#check`.
-/

open Lean Elab Command

/-- `#echo "some text"` — echo a string literal to the browser as an alert. -/
syntax (name := echoCmd) "#echo " str : command

@[command_elab echoCmd]
def elabEchoCmd : CommandElab := fun stx => do
  match stx with
  | `(#echo $s:str) => logInfoAt stx m!"#echo: {s.getString}"
  | _ => throwUnsupportedSyntax
