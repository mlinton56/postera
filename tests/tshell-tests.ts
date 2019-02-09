import {cmd, exec, output, shell, subshell} from 'tshell'
import {ShellListener, JobInfo, ExitStatus, ExitError} from 'tshell'

require('source-map-support').install()
process.on('unhandledRejection', (err, p) => console.log(err.stack))

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

    failed(job: JobInfo, err) {
        this.log('failed', job, err.code)
    }

    protected log(name: string, job: JobInfo, s?: ExitStatus) {
        if (s) {
            console.log(`${name} [${job.ident}] ${job.cmdline}: ${s.toString()}`)
        } else {
            console.log(`${name} [${job.ident}] ${job.cmdline}`)
        }
    }

}

class TestListenerOne extends TestListener {

    started(job: JobInfo) {
        this.log('started', job)
    }

}

class TestListenerTwo extends TestListener {

    finished(job: JobInfo, status: ExitStatus) {
        this.log('finished', job, status)
    }

}

(async function() {
    shell().listenerAdd(new TestListenerOne())
    shell().listenerAdd(new TestListenerTwo())

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
