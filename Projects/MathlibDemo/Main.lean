import VersoManual
import TheLeanFile

def config : Verso.Genre.Manual.RenderConfig where
  emitTeX := false
  emitHtmlSingle := .immediately
  emitHtmlMulti := .no
  htmlDepth := 2

def main := Verso.Genre.Manual.manualMain (%doc TheLeanFile) (config := config)
