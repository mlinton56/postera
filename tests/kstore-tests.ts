/**
 * Test case for postera/kstore.
 *
 * These tests are a bit convoluted because of the specific use cases in mind.
 * Hopefully that doesn't mean the KeyValueStore interface is also convoluted!
 */

import * as kstore from 'postera/kstore'
import {defaultLogger as logger, ConfigurableLogger} from 'postera/slogger'

require('source-map-support').install()

export interface BatchInfo {
    user: string
    keys: string[]
}

let store: kstore.KeyValueStore

process.on('uncaughtException', (err) => logger.error(err))
process.on('unhandledRejection', (err, promise) => logger.error(err))

async function main() {
    const clogger = <ConfigurableLogger>(logger.impl)
    clogger.config = {timeFlag: false, levelFlag: false}
    clogger.level = 'debug'

    store = kstore.redisStore({host: process.env.REDIS_HOST || 'localhost'})

    await store.valueMod('batchId', 0)
    const batchId = (await store.valueIncr('batchId')).toString()
    logger.info('batchId = ' + batchId)

    await addBatch(batchId, 'user', {
        'first': 'This is the first item',
        'second': 'This is the second item'
    })
    logger.info('added batch ' + batchId)

    await status('user', '100')
    await status('user', batchId)
    await status('other', batchId)

    await addResult(batchId, 'first', 'This is the first result')
    await status('user', batchId)
    await addResult(batchId, 'second', 'This is the second result')
    await status('user', batchId)

    const msgbroker = store.broker()
    const topic = 'messages'

    logger.info('Creating subscriber 1')
    const subscriber1 = MySubscriber.initial('1')
    await msgbroker.subscriberAdd(subscriber1, topic)

    logger.info('Creating subscriber 2')
    const subscriber2 = MySubscriber.initial('2')
    await msgbroker.subscriberAdd(subscriber2, topic)

    logger.info('Publishing first message')
    await msgbroker.publish(topic, 'This is the first message')
    await sleep(1)

    logger.info('Publishing second message')
    await msgbroker.publish(topic, 'This is the second message')
    logger.info('Deleting subscriber 1')
    await msgbroker.subscriberDel(subscriber1)
    await sleep(1)

    logger.info('Publishing third message')
    await msgbroker.publish(topic, 'This is the third message')
    await sleep(1)

    logger.info('Deleting subscriber 2')
    await msgbroker.subscriberDel(subscriber2)

    logger.info('Publishing fourth message')
    await msgbroker.publish(topic, 'This is the fourth message')

    store.close()
}

async function addBatch(batchId: string, user: string, batch) {
    const keys = Object.keys(batch)
    await store.mapMod(batchId, {
        info: {user: user, keys: keys},
        length: keys.length
    })
}

async function addResult(b: string, item: string, result: string) {
    if (await store.mapItemMod(b + '/', item, result)) {
        if (await store.mapItem(b, 'length') === await store.mapSize(b + '/')) {
            const info = await store.mapItem(b, 'info')
            const results = await store.map(b + '/')
            if (info && results) {
                logger.info(JSON.stringify(results))
            } else {
                logger.error('Cannot get info or results for ' + b)
            }
        }
    }
}

async function status(user: string, b: string) {
    logger.info('getting status of batch ' + b + ' for ' + user)
    const info = await store.mapItem(b, 'info')
    if (!info) {
        logger.error('Unknown batch ' + b)
    } else if (info.user !== user) {
        logger.error('Wrong user')
    } else {
        logger.info(JSON.stringify(await store.map(b + '/')))
    }
}

function sleep(sec: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        setTimeout(() => {
            resolve()
        }, Math.round(sec * 1000))
    })
}

class MySubscriber implements kstore.Subscriber {

    label: string

    static initial(label: string): MySubscriber {
        const s = new MySubscriber()
        s.label = label
        return s
    }


    messageReceived(topic: string, message: string): void {
        logger.info(this.label + ': "' + message + '"')
    }

}

main()
