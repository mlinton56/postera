/*
 * Copyright (c) 2018 Mark A. Linton
 *
 * Use of this source code is governed by the MIT-style license that is
 * in the LICENSE file or at https://opensource.org/licenses/MIT.
 */

const ffi = require('ffi')
const ref = require('ref')
const Struct = require('ref-struct')


type DynamicLibrary = any

const libraries = new Map<string,DynamicLibrary>()

function dynlib(name: string): DynamicLibrary {
    let lib = libraries.get(name)

    if (!lib) {
        lib = ffi.DynamicLibrary(name)
        libraries.set(name, lib)
    }

    return lib
}

export function library(foreign, defs): any {
    const ffiLib = typeof foreign === 'string' ? dynlib(foreign) : foreign
    const lib: any = {}
    for (const name of Object.keys(defs)) {
        const def = defs[name]
        if (def.length < 1 || def.length > 3) {
            throw new Error(name + ': Bad definition [' + def.join(',') + ']')
        }

        let sym: any
        if (def.length === 1) {
            // ['int64']
            sym = ffiLib.get(name)
            sym.type = def[0]
        } else if (def.length === 2 && typeof def[0] === 'string') {
            // ['dllName', 'int64']
            sym = ffiLib.get(def[0])
            sym.type = def[1]
        } else {
            let s = name
            if (def.length === 3) {
                // ['dllName', params, type]
                s = def[0]
                def.shift()
            }
            sym = ffi.ForeignFunction(ffiLib.get(s), def[1], def[0])
        }
        lib[name] = sym
    }
    return lib
}

export function callback(p: any[], type: any, f: any): any {
    return ffi.Callback(type, p, f)
}

export const types = ref.types
export const voidPtr = ref.refType(ref.types.void)
export const struct = Struct

export function ptr(type) {
    return ref.refType(type)
}
