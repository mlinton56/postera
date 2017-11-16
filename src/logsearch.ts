/**
 * Support for running shell commands in TypeScript.
 *
 * Copyright (c) 2017 Mark A. Linton
 *
 * Use of this source code is governed by the MIT-style license that is
 * in the LICENSE file or at https://opensource.org/licenses/MIT.
 *
VERSION 0.1.0
README
## logsearch

The logsearch module provides a simple interface to search log files,
including an implementation using the
[Papertrail HTTP API](https://help.papertrailapp.com/kb/how-it-works/http-api)
Note that although there is a common interface to construct a search,
the structure of a search result depend on the underlying log implementation.
Seems like it would make sense in the future to provide a common interface
to extract the timestamp, optional level, and text message of a log entry.
EOF
 *
 */

import * as reqm from './reqm'
import logger from './slogger'

/**
 * Parameters for a search. The token authorizes access to logs,
 * name identifies a log or set of logs, start and stop specify a date range
 * that includes the start time and excludes the stop time, newestFirst
 * specifies whether to deliver events oldest-to-newest (default) or
 * newest-to-oldest, and filter is a pattern matched against each log entry.
 *
 * For large searches, one can provide additional parameters to control
 * network/file requests: batchSize is the maximum number of events
 * to retrieve and process at once, retryMax and retryDelay control
 * how to handle a network failure. A search may overlap reading with
 * processing by retrieving additional log entries while processing
 * the current batch.
 */
export class SearchParams {
    token?: string
    name?: string
    start?: Date | string | number
    stop?: Date | string | number
    newestFirst?: boolean
    filter?: string
    batchSize?: number
    retryMax?: number
    retryDelay?: number
}

/**
 * A search is given a result handler operation to call on each log entry.
 *
 * The handler may return a boolean value of false to indicate
 * the search should stop when the handler returns. A handler also
 * may return a Promise that the search process will wait to be fulfilled
 * before processing the next log entry. The way to do that probably is
 * to pass a second parameter to the SearchResultHandler that takes
 * an extractor object that knows how to interpret the log entry
 * for a particular log implementation.
 */
export type SearchResultEntry = any
export type OptionalBoolean = boolean | void
export type SearchResultHandler =
    (entry: SearchResultEntry) => OptionalBoolean | Promise<OptionalBoolean>

/**
 * A search manager creates and execute search processes given
 * parameters and a result handler.
 */
export abstract class SearchManager {

    /**
     * Return a promise to search the logs specified by the search parameters,
     * calling the given handler for each matching log entry in the order
     * specified (default oldest-to-newest or newest-to-oldest if the
     * newestFirst parameter is true.
     */
    abstract search(f: SearchResultHandler, params?: SearchParams): Promise<void>

}

type PapertrailParams = any
type PapertrailBatch = any
type PapertrailEvent = any

const papertrailTokenHeader = 'X-Papertrail-Token'

export class PapertrailManager extends SearchManager {

    private tokenVar: string
    get token() {
        return this.tokenVar
    }
    set token(token) {
        this.tokenVar = token
        const headers = this.requests.defaultOptions.headers
        headers[papertrailTokenHeader] = token
    }

    private requests: reqm.RequestManager
    private defaultParams: SearchParams
    private groupMap: Map<string,string>


    /**
     * Return a new PapertrailManager for the given API token and
     * default search parameters.
     */
    static initial(params?: SearchParams): PapertrailManager {
        const m = new PapertrailManager()
        m.requests = reqm.defaultManager()
        m.defaultParams = Object.assign({batchSize: 250}, params)

        const defaultOptions = m.requests.defaultOptions
        defaultOptions.protocol = 'https:'
        defaultOptions.hostname = 'papertrailapp.com'
        defaultOptions.headers = {[papertrailTokenHeader]: params.token}
        return m
    }


    search(f: SearchResultHandler, searchParams?: SearchParams): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            const params = Object.assign({}, this.defaultParams, searchParams)
            const requests = this.requests
            const headers = requests.defaultOptions.headers
            if (params.token) {
                headers[papertrailTokenHeader] = params.token
            } else if (!headers[papertrailTokenHeader]) {
                reject(new Error('Missing API token'))
                return
            }

            const s = new PapertrailSearch()
            s.requests = requests
            s.func = f
            s.resolve = resolve
            s.reject = reject

            if (params.name) {
                const map = this.groupMap
                if (map) {
                    s.start(params, map)
                } else {
                    this.loadGroupMap().then((m) => s.start(params, m), reject)
                }
            }
        })
    }

    /**
     * Load and cache a map from group name to group id.
     *
     * Assumes the set of groups is static and modest in size.
     */
    private async loadGroupMap() {
        const m = new Map<string,string>()
        this.groupMap = m

        const info = await this.requests.get('/api/v1/groups.json')
        for (const g of info.result) {
            m.set(g.name, g.id)
        }

        return m
    }

    /**
     * React to changes in the group set.
     */
    groupsModified(): void {
        this.groupMap = null
    }

}

/**
 * Implement a search using the Papertrail API.
 *
 * We overlap retrieval and processing using the nextBatch instance variable
 * as a second results buffer. The running flag indicates that the search
 * is in progress, the retrieving flag indicates we are waiting for a request
 * (or waiting to retry one), the delivering flag indicates we are processing
 * a batch.
 */
class PapertrailSearch {

    requests: reqm.RequestManager
    func: SearchResultHandler
    resolve: () => void
    reject: (err) => void

    private options: reqm.RequestOptions
    private apiParams: PapertrailParams
    private newestFirst: boolean
    private startTime: number
    private stopTime: number
    private running: boolean
    private retrieving: boolean
    private delivering: boolean
    private nextBatch: PapertrailBatch
    private retryMax: number
    private retryDelay: number

    start(params: SearchParams, map: Map<string,string>): void {
        this.options = Object.assign({}, this.requests.defaultOptions)
        this.options.pathname = '/api/v1/events/search.json'

        this.apiParams = {}
        const apiParams = this.apiParams

        const group = params.name
        if (group) {
            const groupId = map.get(group)
            if (!groupId) {
                this.fail(new Error('Undefined group "' + group + '"'))
                return
            }

            apiParams.group_id = groupId
        }

        const newestFirst = params.newestFirst

        if (params.start) {
            this.startTime = epochTime(params.start)
            if (!newestFirst) {
                apiParams.min_time = this.startTime
            }
        }
        if (params.stop) {
            this.stopTime = epochTime(params.stop)
            if (newestFirst) {
                apiParams.max_time = this.stopTime
            }
        }
        apiParams.tail = !params.start && !params.stop

        if (params.filter) {
            apiParams.q = params.filter
        }

        if (params.batchSize) {
            apiParams.limit = params.batchSize
        }

        this.newestFirst = newestFirst
        this.retryMax = params.retryMax || 3
        this.retryDelay = Math.round(1000 * (params.retryDelay || 0.25))
        this.running = true
        this.delivering = false

        //
        // After generating the search string we remove min_time and max_time
        // because subsequent calls must use min_id or max_id to avoid duplicates. 
        //
        this.options.search = this.searchString()
        delete apiParams.min_time
        delete apiParams.max_time
        this.retrieveBatch()
    }

    /**
     * Return the Papertrail URL query for the current search.
     * The max/min params change as we make multiple requests for a search.
     */
    private searchString(): string {
        let str

        const params = this.apiParams
        const names = Object.keys(params)
        if (names.length) {
            const p0 = names[0]
            str = '?' + p0 + '=' + encodeURI(params[p0])

            for (let i = 1; i < names.length; ++i) {
                const p = names[i]
                str += '&' + p + '=' + encodeURI(params[p])
            }
        }

        return str
    }

    /**
     * Retrieve a batch using HTTP. We retry if a there is a connection error
     * up to this.retryMax times.
     */
    private retrieveBatch(retryCount = 0): void {
        this.retrieving = true
logger.debug('retrieving batch ' + this.options.search)
        this.requests.get(this.options).then(
            (info) => {
logger.debug('retrieved batch ' + info.result.min_id + ',' + info.result.max_id)
                this.retrieving = false
                if (this.delivering) {
logger.debug('buffering batch')
                    this.nextBatch = info.result
                } else if (this.running) {
                    this.receiveBatch(info.result)
                }
            },
            (err) => {
                if (isNetworkError(err) && retryCount < this.retryMax) {
                    const n = retryCount + 1
                    logger.info('retrieveBatch retry ' + n)
                    setTimeout(() => this.retrieveBatch(n), this.retryDelay)
                } else {
                    this.retrieving = false
                    this.fail(err)
                }
            }
        )
    }

    /**
     * Receive a batch. We might still be working on a batch
     * when a request completes, in which case we simply store
     * the new batch in this.nextBatch. Otherwise, we start delivering
     * the events in the batch.
     *
     * A complicated part here is dealing with Papertrail API quirks.
     * Reading events oldest-to-newest is problematic because Papertrail
     * misinterprets the max_time field when tail=true. Also, Papertrail can
     * return a result with min_id or max_id equal to the passed-in value.
     * We ignore such results to avoid delivering duplicates.
     */
    private receiveBatch(b: PapertrailBatch): void {
        const apiParams = this.apiParams
        if (b.min_id !== apiParams.min_id && b.max_id !== apiParams.max_id) {
            const events = b.events
            const n = events.length
            const startTime = this.startTime
            const stopTime = this.stopTime
            const start = startTime ? this.findTime(events, startTime) : 0
            const stop = stopTime ? this.findTime(events, stopTime) : n
logger.debug('batch start ' + startTime + '(' + start + ')' + ' stop ' + stopTime + '(' + stop + ')')
            if (stop > 0) {
                this.beforeDelivery()
                if (stop >= n &&
                    (b.reached_record_limit || b.reached_time_limit)
                ) {
                    if (this.newestFirst) {
                        apiParams.max_id = b.min_id
                    } else {
                        apiParams.min_id = b.max_id
                    }
                    this.options.search = this.searchString()
                    this.retrieveBatch()
                }
                if (start < stop) {
logger.debug('delivering batch (' + start + '..' + stop + ')')
const first = b.events[start]
logger.debug('first event ' + first.id + ' ' + first.generated_at)
const last = b.events[stop - 1]
logger.debug('last event ' + last.id + ' ' + last.generated_at)
                    this.deliverEvents(b.events, start, stop)
                } else {
                    this.afterDelivery()
                }
                return
            }
        }

        this.succeed()
    }

    /**
     * Find the lowest index of an event generated at or after
     * the given time, assuming the array is ordered oldest to newest.
     */
    private findTime(events: PapertrailEvent[], time: number): number {
        let i = 0
        let j = events.length - 1
        while (i <= j) {
            const k = Math.floor((i + j) / 2)
            const t = Math.round(Date.parse(events[k].generated_at) / 1000)
            if (t < time) {
                i = k + 1
            } else {
                j = k - 1
            }
        }

        return i
    }

    /**
     * Deliver one or more events by calling the search result handler.
     * If the handler returns false (explicitly--not a value that coerces
     * to false) then we stop searching. If the handler returns a promise
     * then we wait for it before continuing to the next event.
     */
    private deliverEvents(
        events: PapertrailEvent[], start: number, stop: number
    ): void {
        try {
            if (this.newestFirst) {
                for (let i = stop - 1; i >= start; --i) {
                    if (this.apply(events[i],
                        () => this.deliverEvents(events, start, i - 1)
                    )) {
                        return
                    }
                }
            } else {
                for (let i = start; i < stop; ++i) {
                    if (this.apply(events[i],
                        () => this.deliverEvents(events, i + 1, stop)
                    )) {
                        return
                    }
                }
            }

            this.afterDelivery()
        } catch (e) {
            this.fail(e instanceof Error ? e : new Error(e.toString()))
        }
    }

    /**
     * Apply the search result handler to the given event. Returns true if
     * either we are done delivering events or we use the given next function
     * to continue delivery when a promise completes--either way the caller
     * should stop delivering. Returns false if the caller should determine
     * whether to continue.
     */
    private apply(event: PapertrailEvent, next: () => void): boolean {
        const f = this.func
        const returnValue = f(event)
        if (returnValue === false) {
            this.succeed()
            return true
        }

        if (returnValue instanceof Promise) {
            const p = <Promise<boolean>>returnValue
            p.then(
                (b) => {
                    if (b === false) {
                        this.succeed()
                    } else {
                        next()
                    }
                },
                (err) => this.fail(err)
            )
            return true
        }

        return false
    }

    /**
     * Note that we are in delivery mode so that receiving the next batch
     * will wait for delivery to complete.
     */
    private beforeDelivery(): void {
        this.delivering = true
    }

    /**
     * After successfully delivering the events in a batch we check
     * if we are still retrieving (in which case just wait there),
     * have a batch ready to deliver (call receiveBatch with the next batch),
     * or are done searching (resolve the search).
     */
    private afterDelivery(): void {
        this.delivering = false

        if (this.retrieving) {
            // Wait for retrieve to complete.
        } else if (this.nextBatch) {
            const nextBatch = this.nextBatch
            this.nextBatch = null
            this.receiveBatch(nextBatch)
        } else {
            this.succeed()
        }
    }

    private succeed(): void {
        this.running = false
        this.nextBatch = null
        const resolve = this.resolve
        resolve()
    }

    private fail(err: Error): void {
        this.running = false
        this.nextBatch = null
        const reject = this.reject
        reject(err)
    }

}

/**
 * Return an epoch time (seconds) given a date, date string, or
 * number of seconds.
 */
function  epochTime(t: Date | string | number): number {
    if (typeof t === 'number') {
        return <number>t
    }

    const ms = (typeof t === 'string') ?  Date.parse(<string>t) : t.valueOf()
    return Math.round(ms / 1000)
}

function isNetworkError(err: Error) {
    return err.message === 'read ECONNRESET'
}
