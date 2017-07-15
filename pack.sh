#!/bin/bash

#
# Generate a package to install with npm.
#
# Usage: pack.sh [-a package] module ...
#
# Packs the given modules either separately or together if -a is specified.
#

set -e
set -o pipefail

if [ "$#" == 0 ]; then
    echo "Usage: pack.sh [-a package] module ..."
    exit 1
fi

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

function extract {
    local src="${1?}"
    sed -e '1,/README/d' -e '/EOF/,$d' < "$src" > "$outdir"/README.md
    version=$(sed -n -e 's/VERSION \(.*\)$/\1/p' < "$src")
    desc=$(sed -e '1d' -e '3,$d' -e 's/ \* //' -e 's/\.$//' < "$src")
    files=$(\
        cd "$outdir" && echo *.{js,ts,map} | \
        sed -e 's/^/"/' -e 's/$/"/' -e 's/ /", "/g' \
    )
}

function pack {
    cp -p $top/LICENSE "$outdir"/

    if [ "$version" == "" ]; then
        version="0.1.0"
    fi

    local extra=""
    if [ "$1" == "" ]; then
        extra='-e /"main":/d -e /"types":/d'
    fi
    sed < "$top/template.json" > "$outdir"/package.json \
        -e 's/$NAME/'$package/ -e 's/$VERSION/'$version/ \
        -e 's/$DESCRIPTION/'"$desc"/ -e 's/$FILES/'"$files"/ \
        $extra
}

if [ "$1" == "-a" ]; then
    shift
    package="${1?}"
    shift

    if [ "$#" == 0 ]; then
        echo "Usage: pack.sh [-a package] module ..."
        exit 1
    fi

    outdir="$build/$package"
    for m in "$@"; do
        srcs="$srcs $srcdir/$m.ts"
    done
    compile $srcs
    for m in "$@"; do
        src="$srcdir/$m.ts"
        sed -e '1,/README/d' -e '/EOF/,$d' < "$src" > "$outdir"/$m.md
    done

    extract "$top/README.md"
    pack
else
    for m in "$@"; do
        package="$m"
        outdir="$build/$package"
        src="$srcdir/$package".ts
        compile "$src"
        sed -e '1,/README/d' -e '/EOF/,$d' < "$src" > "$outdir"/README.md
        version=$(sed -n -e 's/VERSION \(.*\)$/\1/p' < "$src")
        desc=$(sed -e '1d' -e '3,$d' -e 's/ \* //' -e 's/\.$//' < "$src")
        extract "$src"
        pack $m
    done
fi
