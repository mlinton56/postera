/**
 * Test case for postera/kstore.
 *
 * These tests are a bit convoluted because of the specific use cases in mind.
 * Hopefully that doesn't mean the KeyValueStore interface is also convoluted!
 */

import * as kstore from 'postera/kstore'
import logger from 'postera/slogger'

export interface BatchInfo {
    user: string
    keys: string[]
}

const store = kstore.redisStore({host: process.env.REDIS_HOST || 'localhost'})

process.on('uncaughtException', (err) => logger.error(err))
process.on('unhandledRejection', (err, promise) => logger.error(err))

async function main() {
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

    store.impl.quit()
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

main()
