import {cmd, exec, output, shell, subshell} from 'tshell'
import {ShellListener, JobInfo, ExitStatus, ExitError} from 'tshell'

declare function require(m: string): any
require('source-map-support').install()
require('process').on('unhandledRejection', (err, p) => console.log(err.stack))

function log(msg: string): void {
    console.log(message(msg))
}

let t: number = 0
function message(body?: string): string {
    t += 1
    const str = 'test ' + t.toString()
    return body ? (str + ': ' + body) : str
}

class TestListener implements ShellListener {

    started(job: JobInfo) {
        this.log('started', job)
    }

    finished(job: JobInfo, status: ExitStatus) {
        this.log('finished', job)
    }

    failed(job: JobInfo, status: ExitStatus) {
        this.log('failed', job)
    }

    private log(n: string, job: JobInfo) {
        console.log(n + ' [' + job.ident + '] ' + job.cmdline)
    }

}

(async function() {
    shell().listenerAdd(new TestListener())

    const bash = cmd('bash', '-c')
    const echo = cmd('echo')
    const mkdir = cmd('mkdir', '-p')
    const filelist = 'tmp/files.txt'

    await exec("echo", message())

    await echo("hi mom!")
    const echo1 = cmd(echo, message('1'))
    const echo2 = cmd(echo1, "2")
    await echo2("3")

    await exec(mkdir, "tmp")
    await exec('ls', "-1", "-a", "tmp", {'>': filelist})
    await exec('cat', filelist)
    await exec('rm', filelist)
    await exec('rmdir', "tmp")

    const out = await output(echo, "hi mom!", {'<': 'tshell-tests.ts'})
    log('captured "' + out + '"')

    await exec('head', '-1', {'<': 'tshell-tests.ts'})

    try {
        await bash("exit 1")
        log("should not reach here")
    } catch (e) {
        if (e instanceof ExitError) {
            log('ExitError ' + e.code)
        } else {
            console.log(e.stack)
        }
    }

    shell().context.throwFlag = false
    log('status ' + await bash("exit 1"))

    const status = await exec(subshell(async function() {
        log('nested status: ' + await bash("exit 2"))
        shell().exit(3)
    }))
    log('status: ' + status)
})()
