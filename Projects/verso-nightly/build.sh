#!/usr/bin/env bash

# See ../MathlibDemo/build.sh, this is the same principle but for verso/nightly-testing
cd $(dirname $0)
curl -L https://raw.githubusercontent.com/leanprover/verso/nightly-testing/lean-toolchain -o lean-toolchain
lake update -R
lake build

# Additional build steps for prepping literate Lean html output
lake build TheLeanFile:literate
lake exe verso-html .lake/build/literate _out
rm -rf _out
