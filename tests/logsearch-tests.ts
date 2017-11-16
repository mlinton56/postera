import * as logsearch from 'postera/logsearch'
import logger from 'postera/slogger' 

require('source-map-support').install()
process.on('unhandledRejection', (err, p) => console.log(err.stack))

logger.level = 'debug'

async function main(argv: string[]) {
    try {
        const now = Math.round(Date.now() / 1000)
        const m = logsearch.PapertrailManager.initial(params(argv, {
            token: process.env.PAPERTRAIL_API_TOKEN,
            start: 1510701592, stop: 1510701593
            //start: now - 5,
            //newestFirst: true,
            //stop: now
        }))

        await m.search(handleEvent)
    } catch (e) {
        logger.error(e instanceof Error ? <Error>e : e.toString())
    }
}

function handleEvent(event) {
    //console.log(event.generated_at + ': ' + event.id)
    //console.log(event.generated_at + ': ' + event.message)
}

/**
 * Process the command-line arguments.
 */

const usage = 'Usage: node js/logstats.js ' +
    '[--start min-time] ' +
    '[--stop max-time] ' +
    '[--newest-first]'

function params(argv: string[], defaults): logsearch.SearchParams {
    const r: logsearch.SearchParams = {}

    for (const p of Object.keys(defaults)) {
        if (defaults[p] !== undefined) {
            r[p] = defaults[p]
        }
    }

    for (let i = 0; i < argv.length; ++i) {
        switch (argv[i]) {
        case 'help':
        case '-h':
        case '-help':
        case '--help':
            console.log(usage)
            break

        case '--name':
            i = nextArg(argv, i)
            r.name = argv[i]
            break

        case '-b':
        case '-batch-size':
        case '--batch-size':
            i = nextArg(argv, i)
            r.batchSize = parseInt(argv[i])
            break

        case '-newest':
        case '-newest-first':
        case '--newest':
        case '--newest-first':
            r.newestFirst = true
            break

        case '-start':
        case '--start':
            i = nextArg(argv, i)
            r.start = argv[i]
            break

        case '-stop':
        case '--stop':
            i = nextArg(argv, i)
            r.stop = argv[i]
            break

        default:
            throw new Error('Unexpected argument: ' + argv[i])
        }
    }

    return r
}

function nextArg(argv: string[], i: number): number {
    const i1 = i + 1

    if (i1 >= argv.length) {
        throw new Error('Expected argument after ' + argv[i])
    }

    return i1
}

main(process.argv.slice(2))
