#!/bin/bash

top=$(dirname "$POST")
srcdir="$top/src"
build="$top/build"

function compile {
    if [ ! -d "$outdir" ]; then
        mkdir -p "$outdir" && \
        (\
            cd $build && \
            npm install --silent @types/node source-map source-map-support \
        )
    fi
    tsc --outDir "$outdir" --baseUrl $srcdir \
        --target es6 --module commonjs --alwaysStrict true \
        --declaration true --sourceMap true --removeComments true \
        --typeRoots $build/node_modules/@types --types node \
        "$@"
}

for m in "$@"; do
    package="$m"
    outdir="$build/$package"
    src="$srcdir/$package".ts
    compile "$src"
done
