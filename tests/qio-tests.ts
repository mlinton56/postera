import * as qio from 'postera/qio'
import {defaultLogger as logger, ConfigurableLogger} from 'postera/slogger'

require('source-map-support').install()


function log(msg: string): void {
    logger.info(message(msg))
}

let t: number = 0
function message(body?: string): string {
    t += 1
    const str = 'test ' + t.toString()
    return body ? (str + ': ' + body) : str
}

const url = process.env.AMQP_TEST_URL || 'amqp://guest:guest@localhost:5672/'

const ch = qio.Channel.instance(url)

const loaderQueue = {
    name: 'standalone-imageloader',
    url: url,
    options: {durable: true, maxPriority: 10}
}

const recognizerQueue = {
    name: 'standalone-recognizer',
    url: url,
    options: {durable: true, maxPriority: 10}
}

async function add(q) {
    log('adding ' + q.name)
    await ch.queueAddIf(q)
}

function sleep(sec: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        setTimeout(() => {
            resolve()
        }, Math.round(sec * 1000))
    })
}

function clientSim(start: number, count: number) {
    const n = start + count
    for (let i = start; i < n; ++i) {
        const msg = {seq: i, str: "Message #" + i.toString()}
        log('Adding message ' + JSON.stringify(msg))
        ch.messageAdd(loaderQueue, qio.message(msg))
    }
}

function loaderSim() {
    log('loaderSim')
    ch.receiverAdd(loaderQueue, (buf: Buffer, ack?: qio.Ack) => {
        log('Loader receives and adds to ' + recognizerQueue.name)
        ch.messageAdd(recognizerQueue, buf, {}, ack)
    })
}

function recognizerSim(count: number) {
    log('recognizerSim')
    let i = 0
    ch.consumerAdd(recognizerQueue, (msg: Buffer) => {
        log('Recognizer receives ' + msg.toString())
        i += 1
        if (i === count) {
            ch.listenerDelAll()
            ch.connection.listenerDelAll()
            ch.connection.close()
        }
    })
}

(async function() {
    const clogger = <ConfigurableLogger>(logger.impl)
    clogger.config = {timeFlag: false, levelFlag: false}
    clogger.level = 'debug'

    await add(loaderQueue)
    await add(recognizerQueue)

    clientSim(0, 2)
    loaderSim()
    recognizerSim(4)
    for (let i = 0; i < 24; ++i) {
        log(i + ': sleeping')
        await sleep(10)
    }
    clientSim(2, 2)
})()
