#!/usr/bin/env bash

set -e
ulimit -t 120

# Resolve any symlinks in arguments
TEMPLATE_DIR="$(realpath "$1")"  # Where the template project lives
shift
INPUT_FILE="$(realpath "$1")"  # Where the file to work with is located
shift
OUTPUT_DIR="$(realpath "$1")" # The output directory
shift

set +e # Run through errors to ensure the temp file gets moved back

mv $TEMPLATE_DIR/TheLeanFile.lean $TEMPLATE_DIR/TheLeanFile.lean.tmp
cp $INPUT_FILE $TEMPLATE_DIR/TheLeanFile.lean
rm -rf $TEMPLATE_DIR/.lake/build/lib/lean/MakeVerso.olean # Force re-elaboration

# Note: is --keep-toolchain doing anything here? -rjs feb 20 2026
export VERSO_OUTPUT_PATH="$OUTPUT_DIR/_out"
lake --keep-toolchain build

if [ -f "$OUTPUT_DIR/_out/.not-verso-doc" ]; then
    echo "Creating HTML render of Lean file"
    lake build TheLeanFile:literate
    lake exe verso-html .lake/build/literate "$OUTPUT_DIR/_out/html-lit" 
fi

mv $TEMPLATE_DIR/TheLeanFile.lean.tmp $TEMPLATE_DIR/TheLeanFile.lean