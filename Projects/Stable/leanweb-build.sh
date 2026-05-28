#!/usr/bin/env bash

# Operate in the directory where this file is located
cd $(dirname $0)

elan update stable
lake update -R
lake build
