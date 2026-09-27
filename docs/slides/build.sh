#!/bin/sh
set -eu
cd "$(dirname "$0")"
slides_out="${1:-build}"
mkdir -p "$slides_out"
xelatex -interaction=nonstopmode -halt-on-error -no-shell-escape -output-directory="$slides_out" valleytown.tex
xelatex -interaction=nonstopmode -halt-on-error -no-shell-escape -output-directory="$slides_out" valleytown.tex
