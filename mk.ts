/**
 * Builds and packs postera modules.
 *
 * Use the "m" node executable to (re)build and run this code.
 *
 * Usage: m [-v] [module ...]
 *
 * Compile and pack each module separately into a build/module subdirectory,
 * except if the module name ends in '.o', in which case just compile.
 * If no modules are given then compile all modules and pack them into
 * a single postera package.
 */

import * as tshell from './src/tshell'
type Cmd = tshell.Cmd
type ExecArg = tshell.ExecArg
type Program = tshell.Program
type ShellPromise = tshell.ShellPromise

const fs = require('fs')
const relative = require('path').relative

let verbose = false
let top: string
let srcdir: string
let docdir: string
let build: string

const sed = tshell.cmd('sed')


const dependencies = {
    kstore: ['slogger'],
    qio: ['slogger'],
    tshell: [],
    slogger: []
}

export function main(dir: string, argv: string[]): void {
    top = dir
    srcdir = path(dir, 'src')
    docdir = path(dir, 'doc')
    build = path(dir, 'build')

    if (argv[0] === '-v') {
        verbose = true
        argv.shift()
    }

    const p = argv.length ? packList(argv) : packAll()
    p.catch((err) => console.log(err.stack))
}

async function packList(argv: string[]) {
    for (let m of argv) {
        const i = m.indexOf('.o')
        if (i > 0 && i === m.length - 2) {
            const mm = m.slice(0, -2)
            await compile([mm], path(build, mm))
        } else {
            await pack(m)
        }
    }
}

const all = ['tshell', 'slogger', 'qio', 'kstore']

async function packAll() {
    const outdir = path(build, 'postera')
    await compile(all, outdir)
    for (let m of all) {
        const src = path(srcdir, m + '.ts')
        const dst = path(outdir, m + '.md')
        await readme(m, src, dst)
        await exec('cp', '-f', '-p', dst, path(docdir, m + '.md'))
    }

    const postera = path(top, 'README.md')
    logInfo('generating ' + postera)
    await readme('postera', path(top, 'postera.md'), postera)
    await exec('cp', '-f', '-p', postera, path(outdir, 'README.md'))

    const license = path(top, 'LICENSE')
    logInfo('copying ' + relative('', license))
    await copyLicense(license, outdir)
}

async function compile(modules: string[], outdir: string) {
    if (!fs.existsSync(outdir)) {
        logInfo('initializing ' + outdir)
        await exec('mkdir', '-p', outdir)
        await exec('npm', 'install', '--no-package-lock', '--silent',
            '@types/node', 'source-map', 'source-map-support',
            {dir: build}
        )
    }

    const args = []
    const info = []
    for (let m of modules) {
        const src = path(srcdir, m + '.ts')
        const dst = path(outdir, m + '.js')
        const deps = dependencies[m]
        if (!fs.existsSync(dst) || modified(src, dst, deps)) {
            args.push(src)
            info.push(relative('', src))

            mtimes.delete(dst)
            for (let d of deps) {
                mtimes.delete(path(outdir, d + '.js'))
            }
        }
    }

    if (args.length) {
        logInfo('compiling ' + info.join(' '))
        await exec('tsc', '--target', 'es6', '--alwaysStrict', 'true',
            '--baseUrl', srcdir, '--outdir', outdir,
            '--module', 'commonjs', '--removeComments', 'true',
            '--typeRoots', 'node_modules/@types', '--types', 'node',
            '--declaration', 'true', '--sourceMap', 'true', ...args,
            {dir: build}
        )
    }
}

function modified(src: string, dst: string, deps: string[]): boolean {
    const jstime = mtime(dst)
    if (mtime(src) > jstime) {
        return true
    }

    for (let d of deps) {
        if (mtime(path(srcdir, d + '.ts')) > jstime) {
            return true
        }
    }

    return false
}

const mtimes = new Map<string,number>()

function mtime(path: string): number {
    const t = mtimes.get(path)
    if (t) {
        return t
    }

    const v = fs.statSync(path).mtime.valueOf()
    mtimes.set(path, v)
    return v
}


function copyLicense(license: string, outdir: string): ShellPromise {
    return exec('cp', '-f', '-p', license, outdir + '/')
}

function version(src: string): Promise<string> {
    return output(sed, '-n', '-e', 's/VERSION \\(.*\\)$/\\1/p', {'<': src})
}

function description(src: string): Promise<string> {
    return output(edit('1d', '3,$d', 's/ \\* //', 's/\\.$//'), {'<': src})
}

function jsfiles(dir: string): Promise<string> {
    return output('bash', '-c',
        "echo *.{js,ts,map} | sed -e 's/^/\"/' -e 's/$/\"/' -e 's/ /\", \"/g'",
        {dir: dir}
    )
}

async function pack(m: string) {
    const src = path(srcdir, m + '.ts')
    const outdir = path(build, m)
    logInfo('packing ' + relative('', outdir))
    await compile([m], outdir)

    const license = path(top, 'LICENSE')
    logInfo('copying ' + relative('', license))
    await copyLicense(license, outdir)

    const files = await jsfiles(outdir)
    const ver = (await version(src)) || '0.1.0'
    const desc = await description(src)

    await readme(m, src, path(outdir, 'README.md'))

    const pkg = path(outdir, 'package.json')
    logInfo('generating ' + relative('', pkg))
    await exec(
        edit(
            's/$NAME/' + m + '/',
            's/$VERSION/' + ver + '/',
            's/$DESCRIPTION/' + desc + '/',
            's/$FILES/' + files + '/'
        ), {'<': path(top, 'template.json'), '>': pkg}
    )
}

function readme(m: string, src: string, dst: string): ShellPromise {
    logInfo('generating ' + relative('', dst))
    return exec(gendoc(src), {'>': dst})
}

function gendoc(src: string) : Cmd {
    return tshell.subshell(async function() {
        await exec('echo', '<!-- DO NOT EDIT GENERATED CONTENT -->')
        await exec(edit('1,/README/d', '/EOF/,$d'), {'<': src})
    })
}

function edit(...cmds: string[]): Cmd {
    const args = []
    for (let c of cmds) {
        args.push('-e', c)
    }
    return tshell.cmd(sed, ...args)
}

function exec(prog: Program, ...args: ExecArg[]): ShellPromise {
    if (verbose) {
        console.log(cmdline(prog, args))
    }
    return tshell.exec(prog, ...args)
}

function output(prog: Program, ...args: ExecArg[]): Promise<string> {
    if (verbose) {
        console.log(cmdline(prog, args))
    }
    return tshell.output(prog, ...args)
}

function logInfo(s: string) {
    if (!verbose) {
        console.log(s)
    }
}

function cmdline(prog: Program, args: ExecArg[]): string {
    let s

    let p = prog
    for (;;) {
        if (typeof p === 'string') {
            const pStr = <string>p
            if (!s) {
                s = pStr
            } else {
                s = pStr + ' ' + s
            }
            break
        }

        if (!p['args']) {
            s = '[subshell]'
            break
        }

        const c = <Cmd>p
        const args = c.args.join(' ')
        if (s) {
            s = args + ' ' + s
        } else {
            s = args
        }
        p = c.prog
    }

    for (let a of args) {
        if (typeof a === 'string') {
            s = s + ' ' + a
        } else {
            s = s + ' ' + JSON.stringify(a)
        }
    }

    return s
}

function path(...component: string[]): string {
    return component.join('/')
}
