import MakeVerso.TheLeanFile
import Lean
import Verso.Doc
import VersoManual
import VersoBlog

open Lean Elab.Term

#eval show TermElabM _ from do
  let env ← getEnv

  match env.constants.find? (Verso.Doc.docName `MakeVerso.TheLeanFile) with
  | .none =>
    throwError "Document does not contain a lean file"
  | .some (.defnInfo doc) =>
    let destination := (← IO.getEnv "VERSO_OUTPUT_PATH").map (⟨·⟩)
      |>.getD ((← IO.currentDir).join "_out")
    Verso.FS.ensureDir destination

    let extensionImpls := by exact extension_impls%
    let numErrs ← IO.mkRef 0
    let logError := fun err => do
      println! s!"Error while creating document: {err}"
      numErrs.set ((← numErrs.get) + 1)
    let renderConfig : Verso.Genre.Manual.RenderConfig := { destination }

    -- We would like to run this, but it presumes that the identifier exists
    -- let part := TheLeanFile.«the canonical document object name»
    -- Therefore, we run this instead:
    let part ← Meta.evalExpr (Verso.Doc.VersoDoc Verso.Genre.Manual)
      (mkApp (mkConst ``Verso.Doc.VersoDoc [])
      (mkConst ``Verso.Genre.Manual []))
      (doc.value)

    let (text, traversalState) ← Verso.Genre.Manual.traverseHtmlSingle logError renderConfig part.toPart extensionImpls
    Verso.Genre.Manual.emitXrefsJson (destination.join "html-single") traversalState
    Verso.Genre.Manual.emitHtmlSingle logError renderConfig text traversalState extensionImpls
  | .some _ =>
    throwError "Document does not contain an expected definition"
