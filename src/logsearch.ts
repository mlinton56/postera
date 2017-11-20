/**
 * Module for searching log files.
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

    import * as logsearch from 'postera/logsearch'

    const now = Math.round(Date.now() / 1000)
    const m = logsearch.manage('papertrail', {start: now - 60 * 60, stop: now})
    await m.search(handleEvent)

    function handleEvent(event) {
        console.log(event.received_at + ': ' + event.message)
    }
EOF
 */

import {defaultManager, RequestInfo} from './reqm'

const reqm = defaultManager()

/**
 * Parameters for a search. The token authorizes access to logs,
 * group identifies a log or set of logs, start and stop specify a date range
 * that includes the start time and excludes the stop time, newestFirst
 * specifies whether to deliver events oldest-to-newest (default) or
 * newest-to-oldest, and filter is a pattern matched against each log entry.
 *
 * For large searches, one can provide additional parameters to control
 * network/file requests: pageSize is the maximum number of events
 * to retrieve and process at once, retryMax and retryDelay control
 * how to handle a network failure. A search may overlap reading with
 * processing by retrieving additional log entries while processing
 * the current page.
 */
export class SearchParams {
    token?: string
    group?: string
    groupId?: string
    start?: Date | string | number
    stop?: Date | string | number
    newestFirst?: boolean
    filter?: string
    pageSize?: number | string
    retryMax?: number
    retryDelay?: number
}

/**
 * A search is given a result handler operation to call on each log entry.
 *
 * The handler may return a boolean value of false to indicate
 * the search should stop when the handler returns. A handler also
 * may return a Promise that the search process will wait to be fulfilled
 * before processing the next log entry.
 *
 * The search result representation is currently implementation-dependent.
 * Probably should pass a second parameter to a SearchResultHandler that
 * provides access to an entry's timestamp, level, and text.
 */
export type SearchResult = any
export type OptionalBoolean = boolean | void
export type SearchResultHandler =
    (entry: SearchResult) => OptionalBoolean | Promise<OptionalBoolean>

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

/**
 * Return a new search manager for the given implementation.
 */
export function manager(impl: string, defaults?: SearchParams): SearchManager {
    // TODO: Move the Papertrail implementation to a separate module.
    if (impl.toLowerCase() === 'papertrail') {
        return PapertrailManager.initial(defaults)
    }

    throw new Error('Unknown implementation: ' + impl)
}



type PapertrailPage = any
type PapertrailParams = any

const papertrailHeader = 'X-Papertrail-Token'

class PapertrailManager extends SearchManager {

    private tokenVar: string
    get token() {
        return this.tokenVar
    }
    set token(token) {
        this.tokenVar = token
        this.request.headerMod(papertrailHeader, token)
    }

    private request: RequestInfo
    private defaultParams: SearchParams
    private groupMap: Map<string,string>


    /**
     * Return a new PapertrailManager for the given API token and
     * default search parameters.
     */
    static initial(params?: SearchParams): PapertrailManager {
        const m = new PapertrailManager()
        m.defaultParams = Object.assign(
            {token: process.env.PAPERTRAIL_API_TOKEN, pageSize: 250}, params
        )
        m.request = reqm.infoForOptions({
            protocol: 'https:', hostname: 'papertrailapp.com',
            headers: {[papertrailHeader]: m.defaultParams.token},
            method: 'GET'
        })
        return m
    }


    search(f: SearchResultHandler, searchParams?: SearchParams): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            const params = Object.assign({}, this.defaultParams, searchParams)
            const request = this.request
            if (params.token) {
                request.headerMod(papertrailHeader, params.token)
            } else if (!request.header(papertrailHeader)) {
                reject(new Error('Missing API token'))
                return
            }

            const s = params.newestFirst ?
                new PapertrailBackwardSearch() : new PapertrailForwardSearch()

            s.request = request
            s.func = f
            s.resolve = resolve
            s.reject = reject

            if (params.group) {
                if (this.groupMap) {
                    this.startGroup(s, params)
                } else {
                    this.loadMap().then(() => this.startGroup(s, params), reject)
                }
            } else {
                s.start(params)
            }
        })
    }

    private startGroup(s: PapertrailSearch, params: SearchParams): void {
        const groupId = this.groupMap.get(params.group)
        if (groupId) {
            params.groupId = groupId
            s.start(params)
        } else {
            s.reject(new Error('Undefined group "' + params.group + '"'))
        }
    }

    /**
     * Load and cache a map from group name to group id.
     *
     * Assumes the set of groups is static and modest in size.
     */
    private async loadMap() {
        const request = this.request
        request.options.pathname  = '/api/v1/groups.json'
        const info = await reqm.requestForInfo(request)

        const m = new Map<string,string>()
        for (const g of info.result) {
            m.set(g.name, g.id)
        }

        this.groupMap = m
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
 * We overlap retrieval and processing using the nextPage instance variable
 * as a second results buffer. The running flag indicates that the search
 * is in progress, the retrieving flag indicates we are waiting for a request
 * (or waiting to retry one), the delivering flag indicates we are processing
 * a page.
 */
abstract class PapertrailSearch {

    request: RequestInfo
    func: SearchResultHandler
    resolve: () => void
    reject: (err) => void

    protected apiParams: PapertrailParams
    protected startTime: number
    protected stopTime: number
    private running: boolean
    private retrieving: boolean
    private delivering: boolean
    private nextPage: PapertrailPage
    private retryMax: number
    private retryDelay: number

    start(params: SearchParams): void {
        this.apiParams = {}
        const apiParams = this.apiParams

        if (params.groupId) {
            apiParams.group_id = params.groupId
        }

        if (params.start) {
            this.startTime = epochTime(params.start)
        }
        if (params.stop) {
            this.stopTime = epochTime(params.stop)
        }
        apiParams.tail = !params.start && !params.stop

        if (params.filter) {
            apiParams.q = params.filter
        }

        if (params.pageSize) {
            apiParams.limit = params.pageSize
        }

        this.retryMax = params.retryMax || 3
        this.retryDelay = Math.round(1000 * (params.retryDelay || 0.25))
        this.running = true
        this.delivering = false

        const options = this.request.options
        options.pathname = '/api/v1/events/search.json'
        options.search = this.firstSearchString()
        this.retrievePage()
    }

    /**
     * Return the first search string, adding min_time/max_time
     * depending on the delivery order and then removing those apiParams
     * so subsequent calls use min_id/max_id to avoid duplicates.
     */
    protected abstract firstSearchString(): string

    /**
     * Return the next search string, assigning min_id to previous max_id
     * going forward or max_id to previous min_id going backward.
     */
    protected abstract nextSearchString(minId: string, maxId: string): string

    /**
     * Return the Papertrail URL query for the current search.
     * The max/min params change as we make multiple requests for a search.
     */
    protected searchString(): string {
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
     * Retrieve a page using HTTP. We retry if a there is a connection error
     * up to this.retryMax times.
     */
    private retrievePage(retryCount = 0): void {
        this.retrieving = true
        reqm.requestForInfo(this.request).then(
            (info) => {
                this.retrieving = false
                if (this.delivering) {
                    this.nextPage = info.result
                } else if (this.running) {
                    this.receivePage(info.result)
                }
            },
            (err) => {
                if (isNetworkError(err) && retryCount < this.retryMax) {
                    const n = retryCount + 1
                    setTimeout(() => this.retrievePage(n), this.retryDelay)
                } else {
                    this.retrieving = false
                    this.fail(err)
                }
            }
        )
    }

    /**
     * Receive a page. We might still be working on a page
     * when a request completes, in which case we simply store
     * the new page in this.nextPage. Otherwise, we start delivering
     * the events in the page.
     *
     * A complicated part here is dealing with Papertrail API quirks.
     * Reading events oldest-to-newest is problematic because Papertrail
     * misinterprets the max_time field when tail=true. Also, Papertrail can
     * return a result with min_id or max_id equal to the passed-in value.
     * We ignore such results to avoid delivering duplicates.
     */
    private receivePage(p: PapertrailPage): void {
        const minId = p.min_id
        const maxId = p.max_id
        if (minId === this.apiParams.min_d || maxId === this.apiParams.max_id) {
            this.succeed()
            return
        }

        const events = p.events
        const n = events.length
        const startTime = this.startTime
        const stopTime = this.stopTime
        const start = startTime ? this.findTime(events, startTime) : 0
        const stop = stopTime ? this.findTime(events, stopTime) : n
        const tail = this.apiParams.tail
        if (!tail && n > 0 && this.noEvents(n, start, stop)) {
            this.succeed()
            return
        }

        this.beforeDelivery()
        if (tail || p.reached_record_limit || p.reached_time_limit) {
            this.request.options.search = this.nextSearchString(minId, maxId)
            this.retrievePage()
        }
        this.deliver(events, start, stop)
    }

    /**
     * Find the lowest index of an event generated at or after
     * the given time, assuming the array is ordered oldest to newest.
     */
    private findTime(events: SearchResult[], time: number): number {
        let i = 0
        let j = events.length - 1
        while (i <= j) {
            const k = Math.floor((i + j) / 2)
            const t = Math.round(Date.parse(events[k].received_at) / 1000)
            if (t < time) {
                i = k + 1
            } else {
                j = k - 1
            }
        }

        return i
    }

    /**
     * Given that a page of n events has a range of [a,b) where
     * a is the smallest index with time >= startTime and
     * b is the smallest index with time >= stopTime
     * return whether there are no further events in [start,stop).
     *
     * Going forward that means b is 0, going backward a is n.
     */
    protected abstract noEvents(n: number, a: number, b: number): boolean

    /**
     * Call the search result hander for events from [a,b) using
     * this.apply for each event. The implementation depends
     * on the order of search results (oldest-to-newest or newest-to-oldest).
     */
    protected abstract deliver(events: SearchResult[], a: number, b: number): void

    /**
     * Apply the search result handler to the given event. Returns true if
     * the caller should stop delivering--either because the handler
     * returns false or we need to wait for a promise to finish. In the case
     * of a promise completes successfully with a non-false value
     * we will call the given next function to continue delivery.
     */
    protected apply(event: SearchResult, next: () => void): boolean {
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
     * Note that we are in delivery mode so that receiving the next page
     * will wait for delivery to complete.
     */
    protected beforeDelivery(): void {
        this.delivering = true
    }

    /**
     * After successfully delivering the events in a page we check
     * if we are still retrieving (in which case just wait there),
     * have a page ready to deliver (call receivePage with the next page),
     * or are done searching (resolve the search).
     */
    protected afterDelivery(): void {
        this.delivering = false

        if (this.retrieving) {
            // Wait for retrieve to complete before any further processing.
        } else if (this.nextPage) {
            // Next page is ready, start processing it.
            const nextPage = this.nextPage
            this.nextPage = null
            this.receivePage(nextPage)
        } else {
            // Not retrieving, no next page, so we must be done.
            this.succeed()
        }
    }

    protected succeed(): void {
        this.running = false
        this.nextPage = null
        const resolve = this.resolve
        resolve()
    }

    protected fail(err: Error): void {
        this.running = false
        this.nextPage = null
        const reject = this.reject
        reject(err)
    }

}

/**
 * Search implementation that delivers events oldest-to-newest.
 */
class PapertrailForwardSearch extends PapertrailSearch {

    protected firstSearchString(): string {
        const apiParams = this.apiParams
        if (this.startTime) {
            apiParams.min_time = this.startTime
        }

        const search = this.searchString()

        delete apiParams.min_time

        return search
    }

    protected nextSearchString(minId: string, maxId: string): string {
        this.apiParams.min_id = maxId
        return this.searchString()
    }

    protected noEvents(n: number, a: number, b: number): boolean {
        return b <= 0
    }

    protected deliver(events: SearchResult[], a: number, b: number): void {
        try {
            for (let i = a; i < b; ++i) {
                if (this.apply(events[i],
                    () => this.deliver(events, i + 1, b)
                )) {
                    return
                }
            }

            this.afterDelivery()
        } catch (e) {
            this.fail(e instanceof Error ? e : new Error(e.toString()))
        }
    }

}

/**
 * Search implementation that delivers events newest-to-oldest.
 */
class PapertrailBackwardSearch extends PapertrailSearch {

    protected firstSearchString(): string {
        const apiParams = this.apiParams
        if (this.stopTime) {
            // stopTime is exclusive, max_time is inclusive
            apiParams.max_time = this.stopTime - 1
        }

        const search = this.searchString()

        delete apiParams.max_time

        return search
    }

    protected nextSearchString(minId: string, maxId: string): string {
        this.apiParams.max_id = minId
        return this.searchString()
    }

    protected noEvents(n: number, a: number, b: number): boolean {
        return a >= n
    }

    protected deliver(events: SearchResult[], a: number, b: number): void {
        try {
            for (let i = b - 1; i >= a; --i) {
                if (this.apply(events[i],
                    () => this.deliver(events, a, i - 1)
                )) {
                    return
                }
            }

            this.afterDelivery()
        } catch (e) {
            this.fail(e instanceof Error ? e : new Error(e.toString()))
        }
    }

}

/**
 * Return an epoch time (seconds) given a date, date string, or
 * number of seconds.
 */
function epochTime(t: Date | string | number): number {
    if (typeof t === 'number') {
        return <number>t
    }

    const ms = (typeof t === 'string') ?  Date.parse(<string>t) : t.valueOf()
    return Math.round(ms / 1000)
}

function isNetworkError(err: Error) {
    return err.message === 'read ECONNRESET'
}
