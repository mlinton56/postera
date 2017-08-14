/**
 * Support for running shell commands in TypeScript.
 *
 * Copyright (c) 2017 Mark A. Linton
 *
 * Use of this source code is governed by the MIT-style license that is
 * in the LICENSE file or at https://opensource.org/licenses/MIT.
 *
VERSION 0.1.1
README
## tshell

The tshell module provides a simple interface to a subset of
the functionality of the Nodejs child process primitives. It is intended
as an alternative to writing some shell scripts.

A _command_ is a function to run a _program_, specified by a string or
another command, with an optional list of string arguments. A global object,
returned by the _shell_ function, defines the execution context, including
environment variables, current directory, and standard I/O redirection.
A command function returns a promise for the exit status of the process,
which is either an exit code (number) or error.

#### Commands
    import { cmd, shell, exec, output, subshell } from 'tshell'

    // Run a command
    const status = await cmd('echo')('hi mom!')

    // Create a command and then run it.
    const echo = cmd('echo')
    const status = await echo('hi mom!')

    // Create a command with (some) arguments and run it.
    const ls = cmd('ls', '-l')
    const status = await ls('.')

    // Non-zero exit status throws an exception by default.
    try {
        await cmd('cat')('no-such-file')
    } catch (e) {
        // e is a RangeError subclass with e.code === 1
    }

    // Capture output of a command
    const out = await output(cmd(echo, 'hi mom!'))

#### Contexts
When a command function is called, the configuration of the child process
depends on the current context, which is defined as a global instead of being
passed as an argument in every call. The _exec_ function allows one to override
the context when executing a specific command. One can use this function
to redirect the input or output of the command.

    // Redirect input or output.
    await exec(cmd(echo, 'hi mom!'), { '>': 'out.txt' })
    await exec(cmd(sort, '-n'), { '<': 'data.txt', '>': 'sorted.txt' })

    // Explicity modify the shell context to avoid exception.
    const sh = shell()
    sh.context.throwFlag = false
    const status = await cmd('cat')('no-such-file')
    // status === 1

#### Subshells
The _subshell_ function handles sequential nesting by returning
a special command that calls a user-defined async function.
This feature is useful to encapsulate calls to commands in a different context.

    // Function body as a command.
    async function body() {
        await echo('hi mom!')
        if (cond) {
            shell().exit(1)
            return
        }

        await echo('goodbye')
    }
    await exec(subshell(body), { '>': output })

Using a global works well for a single path of execution, but the use of await
means one should be careful using multiple code blocks that execute commands.
If there might be parallel command execution,
such as executing commands in a callback,
one must use the _result_ method to ensure the current context
is properly restored before continuing after a use of await.

    // Multiple parallel shell context
    await exec(subshell(async function() {
        const sh = shell()
        sh.context.throwFlag = true
        if (sh.result(await echo('hi mom!')) !== 0) {
            sh.exit(0)
            return
        }
        sh.result(await echo('goodbye'))
    }))
EOF
 *
 */

// Direct access to Nodejs builtin modules--no type-checking here.
declare function require(m: string): any
const process = require('process')
const child_process = require('child_process')
const fs = require('fs')


/**
 * ExitStatus is the type for the status resulting from
 * the execution of a command.
 */
export type ExitStatus = number | Error

/**
 * ShellPromise is the type returned by running a command.
 *
 * This type is a class to allow it to work everywhere, including
 * calling the constructor. Because of how the Promise class constructor
 * works (immediately running the executor parameter) we can't really
 * provide functionality in a subclass. Otherwise, it might make sense
 * to merge in the ChildTask class here.
 */
export class ShellPromise extends Promise<ExitStatus> {}

/**
 * ExitError is thrown by a command if throwFlag is true and
 * the command exited with a non-zero code.
 */
export class ExitError extends RangeError {

    cmdline: string
    code: number

    constructor(cmdline: string, code: number) {
        super(cmdline + ': exited with ' + code.toString())
        this.code = code
    }

}

/**
 * SignalError is thrown by a command if throwFlag is true and
 * the command exited because of a signal.
 */
export class SignalError extends Error {

    cmdline: string
    signal: string

    constructor(cmdline: string, signal: string) {
        super(cmdline + ': ' + signal)
        this.cmdline = cmdline
        this.signal = signal
    }

}

/**
 * A command function takes an argument list and returns a promise.
 */
export interface CmdFunction {
    (...args: string[]): ShellPromise
}

/**
 * A command may refer to an async function.
 */
export type ShellFunc = () => Promise<void>

/**
 * A program reference may be a string, a shell function, or another command.
 */
export type Program = string | ShellFunc | Cmd

/**
 * A command is a function that runs a program with an argument list.
 *
 * If the argument list is undefined then the command's program
 * is a shell function.
 */
export interface Cmd extends CmdFunction {
    prog: Program
    args?: string[]
}

/**
 * Return a command for a given program and argument list.
 *
 * I don't know a better way to construct a function implementation
 * that exports additional properties.
 */
export function cmd(prog: Program, ...args: string[]): Cmd {
    const f = (...args2: string[]) => {
        return promise(prog, args.concat(args2))
    }

    const c = <Cmd>(f)
    c.prog = prog
    c.args = args
    return c
}

/**
 * Return a command to create a new shell, run the given function, and
 * then restore the original shell. Note that in a multi-shell environment
 * it will also be necessary to ensure restoration of the original context
 * using the Shell#result method.
 */
export function subshell(body: ShellFunc): Cmd {
    const f = (...args: string[]) => {
        return promise(body, args)
    }

    const c = <Cmd>(f)
    c.prog = body
    return c
}

function promise(p: Program, args: string[]): ShellPromise {
    return current.task(p, args).promise()
}

/**
 * ShellListener defines notifications for the execution of a command.
 */
export interface ShellListener {
    started?(info: JobInfo): void
    finished?(info: JobInfo, status: ExitStatus): void
    failed?(info: JobInfo, err: Error): void
}

/**
 * JobInfo provides information about a command being executed
 * to allow the use of the same listener for multiple runs.
 */
export class JobInfo {
    shell: Shell
    ident: number
    context: Context
    prog: Program
    args: string[]
    pid: number

    get cmdline() {
        const p = this.prog
        if (typeof p === 'string') {
            return cmdline(p, this.args)
        }

        const command = <Cmd>p
        const func = <ShellFunc>(command.prog)
        return func.name + '()'
    }
}

/**
 * For redirecting command input or output. Should use a real interface
 * instead of any here, but not ready to pull that ball of yarn.
 */
export type Stream = any

/**
 * Optional context information for running a command.
 */
export class Context {
    dir?: string
    env?: object
    throwFlag?: boolean
    traceFlag?: boolean
    detachedFlag?: boolean

    '<'?: string | Stream
    '>'?: string | Stream
    '>&'?: string | Stream
    '>>'?: string | Stream
    '>>&'?: string | Stream

    listener?: ShellListener
    listeners?: ShellListener[]
}

const contextSimpleProps = [
    'dir', 'throwFlag', 'traceFlag', 'detachedFlag', '<', '>', '>&', '>>', '>>&'
]


/**
 * We would like to call exec and output with a variable number of strings and
 * an optional context, but TypeScript (and most languages) can't handle that.
 * So we pass a variable number of ExecArg arguments, where ExecArg is
 * a string or context, and have a helper function to convert ExecArg[] to
 * [string[], Context].
 */
export type ExecArg = string | Context
type ExecArgs = [string[], Context]

function execArgs(arglist: ExecArg[]): ExecArgs {
    let args
    let context

    if (arglist.length > 0) {
        let n = arglist.length - 1
        if (typeof arglist[n] === 'string') {
            args = <string[]>arglist
        } else {
            args = <string[]>arglist.slice(0, -1)
            context = <Context>(arglist[n])
        }

        // Sigh.
        for (let i = 0; i < args.length; ++i) {
            if (typeof args[i] !== 'string') {
                throw new TypeError('args[' + i + ']: string required')
            }
        }
    }

    return [args, context]
}

/**
 * Run a program with the given arguments in a given context.
 *
 * This function is primarily useful for redirection, e.g.,
 *
 *     exec('ls', { '>': 'filelist.txt' })
 */
export function exec(p: Program, ...arglist: ExecArg[]): ShellPromise {
    const [args, context] = execArgs(arglist)
    return current.task(p, args, context).promise()
}

/**
 * Run a program with the given arguments and return the output (stdout).
 */
export function output(p: Program, ...arglist: ExecArg[]): Promise<string> {
    const sh = current
    const [args, context] = execArgs(arglist)
    const task = sh.task(p, args, context)
    task.captured = ''
    return new Promise<string>((resolve, reject) => {
        const throwFlag = sh.context.throwFlag

        function returnError(err: Error): void {
            sh.status = err
            if (throwFlag) {
                reject(err)
            } else {
                resolve(task.captured)
            }
        }

        task.exec(
            (status) => {
                if (status === 0 || !throwFlag) {
                    sh.status = status
                    resolve(task.captured)
                } else {
                    returnError((typeof status === 'number') ?
                        new ExitError(task.cmdline(), <number>status) :
                        <Error>status
                    )
                }
            },
            (err) => returnError(err)
        )
    })
}

/**
 * Interface to control execution context.
 */
export interface Shell {
    /**
     * Execution context.
     */
    context: Context

    /**
     * Add a listener to the shell's context.
     */
    listenerAdd(listener: ShellListener): void

    /**
     * Remove a listener from the shell's context, returning the listener
     * if found and removed or null otherwise.
     */
    listenerDel(listener: ShellListener): ShellListener

    /**
     * Remove all listeners from the shell's context.
     */
    listenerDelAll(): void

    /**
     * Passes back the result from a command and resets the shell context.
     *
     * This filter is only necessary with an await expression, e.g.,
     * sh.result(await cmd()) where multiple contexts may be running.
     */
    result(value: ExitStatus): ExitStatus

    /**
     * Set the exit status from a shell body. Note it is not sufficient
     * to call this method--one must also return from the body, e.g.,
     *
     * await exec(subshell(() => {
     *     if (cond) {
     *         shell().exit(1)
     *         return
     *     } else {
     *         // continue to do more
     *     }
     * }))
     */
    exit(code: number): void
}

/**
 * Return the current shell.
 */
export function shell(): Shell {
    return current
}


/**
 * Implementation of the Context interface for the ShellImpl class.
 */
class ShellContext extends Context {

    /**
     * Return a new context optionally customized with additional information.
     */
    static initial(additions?: Context) {
        const c = new ShellContext()
        c.env = {}
        c.listeners = []
        c.merge(additions)
        return c
    }

    /**
     * Return a copy of this context to customize command information,
     * overriding with any values given in the additions parameter.
     *
     * Have to be careful here--can't do "if (prop[key])" with
     * boolean properties.
     */
    clone(additions?: Context): ShellContext {
        const c = new ShellContext()
        c.env = {}
        c.listeners = []
        c.merge(this)
        c.merge(additions)
        return c
    }

    /**
     * Merge the given context into this context. Scalars and env entries
     * in the given context are copied to this context, overwriting
     * existing values, but listeners are always added to the list
     * in this context.
     */
    private merge(context?: Context): void {
        if (context) {
            for (let p of Object.keys(context)) {
                if (context[p] !== undefined &&
                    p !== 'env' && p !== 'listener' && p !== 'listeners'
                ) {
                    this[p] = context[p]
                }
            }

            if (context.env) {
                Object.assign(this.env, context.env)
            }

            if (context.listener) {
                this.listeners.push(context.listener)
            }

            if (context.listeners) {
                this.listeners.push(...context.listeners)
            }
        }
    }

}


/**
 * Shell implementation.
 */
class ShellImpl implements Shell {

    context: ShellContext
    stdin: Stream
    stdout: Stream | string
    stderr: Stream

    jobIdent: number
    status: ExitStatus

    /**
     * Return the top-level instance.
     */
    private static instanceVar: ShellImpl

    static get instance() {
        if (ShellImpl.instanceVar) {
            return ShellImpl.instanceVar
        }

        const sh = new ShellImpl()

        sh.context = ShellContext.initial({
            dir: process.cwd(),
            env: process.env,
            throwFlag: true,
            traceFlag: false,
            detachedFlag: false,
            '<': null,
            '>': null,
            '>&': null,
            '>>': null,
            '>>&': null
        })

        sh.stdin = process.stdin
        sh.stdout = process.stdout
        sh.stderr = process.stderr
        sh.jobIdent = 0
        sh.status = 0

        ShellImpl.instanceVar = sh

        return sh
    }


    /**
     * Return a copy of the shell and copy values from the given context.
     */
    clone(context?: Context): ShellImpl {
        const sh = new ShellImpl()
        sh.context = this.context.clone(context)
        sh.stdin = this.stdin
        sh.stdout = this.stdout
        sh.stderr = this.stderr
        sh.jobIdent = 0
        sh.status = 0
        return sh
    }

    /** Implements Shell#listenerAdd. */
    listenerAdd(listener: ShellListener): void {
        this.context.listeners.push(listener)
    }

    /** Implements Shell#listenerDel. */
    listenerDel(listener: ShellListener): ShellListener {
        const listeners = this.context.listeners
        for (let i = 0; i < listeners.length; ++i) {
            if (listeners[i] === listener) {
                listeners.splice(i, 1)
                return listener
            }
        }

        return null
    }

    /** Implements Shell#listenerDelAll. */
    listenerDelAll(): void {
        this.context.listeners = []
    }

    /** Implements Shell#result. */
    result(value: ExitStatus): ExitStatus {
        current = this
        return value
    }

    /** Implements Shell#exit. */
    exit(code: number): void {
        this.status = code
        if (code !== 0 && this.context.throwFlag) {
            throw new ExitError('exit ' + code.toString(), code)
        }
    }


    /**
     * Return a task that runs a given program. For a task that specifies
     * a simple program, we return a ChildTask that spawns a process.
     * Otherwise, the task must specify a function (ShellFunc), in which case
     * we return a ShellTask.
     */
    task(prog: Program, args: string[], context?: Context): CmdTask {
        const jobIdent = this.jobIdent + 1
        this.jobIdent = jobIdent

        const job = new JobInfo()
        job.ident = jobIdent
        job.shell = this
        job.context = context ? this.context.clone(context) : this.context
        flatten(prog, args, job)

        const p = job.prog
        switch (typeof p) {
        case 'string':
            // Create a task spawns a child process.
            return ChildTask.initial(this, <string>p, job)

        case 'function':
            // Task runs ShellFunc body in new shell.
            return ShellTask.initial(this, <ShellFunc>((<Cmd>p).prog), job)

        default:
            throw new Error('Unexpected type ' + (typeof p))
        }
    }

}

/**
 * Abstract base class that encapsulates state transitions during
 * the execution of a command. The base class provides the logic
 * for redirecting I/O, which is serialized so that an error redirecting
 * standard input or output is reported to (the correct) standard error.
 */
abstract class CmdTask {

    protected sh: ShellImpl
    protected job: JobInfo
    protected context: Context
    protected stdio: (Stream | string)[]
    protected input: Stream
    protected output: string[]

    protected resolveFunc: (result: ExitStatus) => void
    protected rejectFunc: (err: Error) => void
    protected get errorFunc() { return (err: Error) => this.errorNotify(err) }


    /**
     * Initialize the task's context and stdio from the given shell and
     * optional context overrides.
     */
    protected init(sh: ShellImpl, job: JobInfo) {
        this.sh = sh
        this.job = job
        this.context = job.context
        this.stdio = [sh.stdin, sh.stdout, sh.stderr]
    }


    /**
     * Captured is a public string attribute that reflects the aggregate value
     * of the protected output property.
     */
    get captured(): string {
        return this.output.join().replace(/\n+/g, ' ').trim()
    }
    set captured(c: string) {
        this.output = c ? [c] : []
    }


    /**
     * Return a promise for the task.
     */
    promise() {
        return new ShellPromise((resolve, reject) => this.exec(resolve, reject))
    }

    /**
     * Execute the task using the given handler functions.
     */
    exec(resolve, reject): void {
        this.resolveFunc = resolve
        this.rejectFunc = reject

        this.post('started', this.job)
        this.redirectInput()
    }

    /**
     * This code is ugly because it didn't work to pass a readable stream
     * as stdio[0] to child_process.spawn--appears one must pipe the stream
     * to child.stdin in that case. Could always pipe but that seems
     * like overkill for simple redirection, so the approach is to use
     * an fd if the redirect is a filename and pipe any other object
     * to child.stdin.
     */
    private redirectInput(): void {
        const s = this.context['<']
        if (!s) {
            this.redirectOutput()
            return
        }

        switch (typeof s) {
        case 'string':
            fs.open(s, 'r', (err, fd) => {
                if (err) {
                    this.errorNotify(err)
                } else {
                    this.stdio[0] = fd
                    this.redirectOutput()
                }
            })
            break

        case 'number':
            this.stdio[0] = s
            this.redirectOutput()
            break

        default:
            if (typeof s.pipe === 'function') {
                // Assume it is a stream.
                this.input = s
                this.stdio[0] = 'pipe'
                this.redirectOutput()
            } else {
                this.errorNotify(new Error('Unrecognized input ' + s))
            }
            break
        }
    }

    private redirectOutput(): void {
        const both = this.ostream('>>&', '>&')
        if (both) {
            both.on('open', (fd) => {
                this.stdio[1] = both
                this.stdio[2] = both
                this.run()
            })
        } else {
            const s = this.ostream('>>', '>')
            if (s) {
                s.on('open', (fd) => {
                    this.stdio[1] = s
                    this.redirectError()
                })
            } else {
                this.redirectError()
            }
        }
    }

    private redirectError(): void {
        const s = this.ostream('2>>', '2>')
        if (s) {
            s.on('open', (fd) => {
                this.stdio[2] = s
                this.run()
            })
        } else {
            this.run()
        }
    }

    private ostream(a: string, w: string): Stream {
        const sa = this.context[a]
        if (sa) {
            if (typeof sa === 'string') {
                return this.checked(fs.createWriteStream(sa, { flags: 'a' }))
            }

            return sa
        }

        const sw = this.context[w]
        if (typeof sw === 'string') {
            return this.checked(fs.createWriteStream(sw))
        }

        return sw
    }

    private checked(s: Stream): Stream {
        s.on('error', this.errorFunc)
        return s
    }


    /**
     * Run the command after redirection.
     */
    protected abstract run(): void

    /**
     * Handle stream or startup errors.
     */
    protected errorNotify(err: Error): void {
        if (this.context.throwFlag) {
            this.returnError(this.sh, err)
        } else {
            const out = this.stdio[2]
            writeln(out, err.message, () => this.returnError(this.sh, err))
        }
    }

    /**
     * Handle completion with the given status. Depending on the context,
     * we might reject if the status is non-zero.
     */
    protected returnStatus(sh: ShellImpl, s: ExitStatus): void {
        current = sh
        if (s === 0 || !sh.context.throwFlag) {
            sh.status = s
            this.resolveFunc.call(null, s)
            this.post('finished', this.job, s)
        } else {
            let err: Error
            if (typeof s === 'number') {
                err = new ExitError(this.cmdline(), <number>s)
            } else {
                err = <Error>s
            }

            sh.status = err
            this.rejectFunc.call(null, err)
            this.post('failed', this.job, s)
        }
    }

    /**
     * Handle completion with the given error. Depending on the context.
     * we might resolve.
     */
    protected returnError(sh: ShellImpl, err: Error): void {
        current = sh
        sh.status = err
        if (sh.context.throwFlag) {
            this.rejectFunc.call(null, err)
            this.post('failed', this.job, err)
        } else {
            this.resolveFunc.call(null, err)
            this.post('finished', this.job, err)
        }
    }

    private post(notification: string, ...args: any[]): void {
        for (let listener of this.context.listeners) {
            process.nextTick(() => listener[notification].apply(listener, args))
        }
    }


    abstract cmdline(): string

}

/**
 * Execute a command by running a child process.
 */
class ChildTask extends CmdTask {

    private arg0: string
    private args: string[]


    static initial(sh: ShellImpl, arg0: string, job: JobInfo): ChildTask {
        const task = new ChildTask()
        task.init(sh, job)
        task.arg0 = arg0
        task.args = job.args
        return task
    }


    /**
     * Spawn a child process to run a command.
     */
    protected run(): void {
        const context = this.context

        //
        // If stdout is a string array then that means we want to capture
        // the child output in the array.
        //
        let output = this.output
        if (output) {
            this.stdio[1] = 'pipe'
        }

        const child = child_process.spawn(this.arg0, this.args, {
            cwd: context.dir,
            env: context.env,
            stdio: this.stdio,
            detached: context.detachedFlag
        })

        if (this.input) {
            this.input.pipe(child.stdin)
        }

        // Capture the child process stdout.
        if (output) {
            child.stdout.on('data', (data) => output.push(data))
        }

        // Catch errors associated with redirection or startup.
        child.on('error', this.errorFunc)

        // Wait for the child to exit and its stdio streams are closed.
        child.on('close', (code: number, signal: string) => {
            if (signal) {
                this.returnError(this.sh, new SignalError(this.cmdline(), signal))
            } else {
                this.returnStatus(this.sh, code)
            }
        })

        this.job.pid = child.pid
    }

    cmdline(): string {
        return cmdline(this.arg0, this.args)
    }

}

/**
 * ShellTask is a CmdTask subclass that executes a code block that returns
 * a ShellPromise.
 */
class ShellTask extends CmdTask {

    private func: ShellFunc


    static initial(sh: ShellImpl, f: ShellFunc, job: JobInfo): ShellTask {
        const task = new ShellTask()
        task.init(sh, job)
        task.func = f
        return task
    }


    protected run(): void {
        current = this.sh.clone(this.context)
        this.func.call(null).then(
            (none) => this.returnStatus(this.sh, this.sh.status),
            (err) => this.returnError(this.sh, err)
        )
    }

    cmdline(): string {
        return this.func.name + '()'
    }

}

/**
 * Flatten the program and arguments in a job, e.g., for
 *
 *     const bash = cmd('bash')
 *     const bashcmd = cmd(bash, '-c')
 *     await exec(bashcmd, 'echo "hi mom!"')
 *
 * we want {prog: 'bash', args: ['-c', 'echo "hi mom!"']}.
 */
function flatten(prog: Program, args: string[], job: JobInfo): void {
    const list: string[][] = args ? [args] : []
    const visited = new Set<Cmd>()
    
    let p = prog
    while (typeof p !== 'string' && p['args']) {
        const c = <Cmd>p
        if (visited.has(c)) {
            throw new Error('Command reference cycle')
        }
        visited.add(c)
        list.push(c.args)
        p = c.prog
    }

    job.prog = p
    job.args = []
    for (let i = list.length - 1; i >= 0; --i) {
        job.args.push(...list[i])
    }
}


/**
 * Return a single string representing a command line for program and arg list.
 */
function cmdline(prog: string, argv: string[]): string {
    return [quoteIf(prog), ...argv.map(quoteIf)].join(' ')
}

const dq = '"'
const sq = "'"

function quoteIf(s: string): string {
    let r = s
    if (r.indexOf(dq) >= 0) {
        if (r.indexOf(sq) >= 0) {
            r = s.replace(/'/g, "\\'")
        }
        r = sq + r + sq
    } else if (r.indexOf(sq) >= 0 || r.indexOf(' ') >= 0) {
        r = dq + s + dq
    }

    return r
}


/**
 * Write a string to the given stream and call the given function, if any,
 * after the write is finished.
 */
function write(out: Stream, s: string, f: () => void) {
    if (out.write(s)) {
        f()
    } else {
        out.on('drain', f)
    }
}

function writeln(out: Stream, s: string, f: () => void) {
    write(out, s + '\n', f)
}

/**
 * Initialize the global shell using information from the process.
 */
let current = ShellImpl.instance
