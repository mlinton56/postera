/**
 * Module for managing HTTP requests to a service.
 *
 * Copyright (c) 2017 Mark A. Linton
 *
 * Use of this source code is governed by the MIT-style license that is
 * in the LICENSE file or at https://opensource.org/licenses/MIT.
VERSION 0.1.1
README
## reqm

The reqm module provides an interface to make HTTP requests in either
Node.js or a browser environment that return a promise
of a RequestInfo instance. This approach allows one to use await
to block until the request completes. Requests specify options
with a URL string or an object that conforms to the RequestOptions interface.
The default object in the reqm module is a RequestManager instance
specific to the execution environment (Node.js or web browser). This object
contains a default set of request options that the request argument overrides.
Options may be specified individually or together in a url option.

    import defaultManager from 'postera/reqm'
    const reqm = defaultManager()

    reqm.defaultOptions.protocol = 'https:'
    reqm.defaultOptions.hostname = 'httpbin.org'
    reqm.defaultOptions.headers = {'authorization': accessToken}
    let r = await reqm.get({pathname: '/html'})

    reqm.defaultOptions.url = 'https://httpbin.org'

    r = await reqm.get('/html')
    console.log(r.result)

    r = await reqm.post('/post', {name: 'example', {x: 3, y: 4}})
    console.log(r.result.data)

The return value from a request is an instance of RequestInfo, which provides
access to the request options (using the properties protocol, method, headers,
et al.) and the response (using the responseHeader method and
the responseType, statusCode, statusText, responseXml, responseBody, and result
getters). If the responseType is JSON then the result is JSON.parse called
on the responseBody (or the error thrown by JSON.parse, if there is one).

The put, post, and patch methods take an additional body and
optional type parameter. The body is optional for the del(ete) method.
If no type is given RequestManager assumes the type is JSON, and if the type
is JSON (either explicitly or implicitly) then JSON.stringify(body) will be
sent in the request. If the given body is a function then the manager
will call the function passing an object that has a write method with
a string parameter. The string result from calling body(writer) is then
sent as request body.

A request that fails will reject the returned promise, which throws an exception
in the await case. A request manager has two special function properties,
redirector and authorizer, to process error cases involving a 3xx or 401 status,
respectively. Each function is given the RequestInfo instance and
the resolve and reject functions to fulfill or reject the promise.

Request managers are also notifiers for the RequestListener interface,
generating notifications when a request succeeds, is redirected, fails
with a 4xx or 5xx status, gets an error while sending the request, or
gets an error while receiving the response.
EOF
 */

import Notifier from './notifier'

/**
 * RequestListener receives notifications associated with processing a request.
 */
export interface RequestListener {
    requestSent?(r: RequestInfo): void

    /** Status 2xx */
    requestSucceeded?(r: RequestInfo): void

    /** Status 3xx */
    requestRedirected?(r: RequestInfo): void

    /** Status 4xx or 5xx */
    requestUnauthenticated?(r: RequestInfo): void
    requestFailed?(r: RequestInfo): void


    /** Network error while sending request */
    requestError?(r: RequestInfo, err: Error): void

    /** Network error while receiving the response */
    responseError?(r: RequestInfo, err: Error): void
}

/**
 * Options one can specify when making a request.
 */
export interface RequestOptions {
    url?: string
    protocol?: string
    hostname?: string
    port?: number
    method?: string
    pathname?: string
    search?: string
    hash?: string
    headers?: any
    timeout?: number
}

/**
 * Return a RequestOptions object from an implementation-dependent URL object,
 * which should only contain RequestObjects fields excluding url.
 *
 * The important feature here is that we do not copy null values from the
 * URL object so we get the desired result when using Object.assign.
 */
export function urlOptions<T extends object>(urlObject: T): RequestOptions {
    const options = {}

    // Ugly cast here to allow keyof T as a RequestOptions index.
    for (const prop in <any>urlObject) {
        if (urlObject.hasOwnProperty(prop)) {
            const value = urlObject[prop]

            // Don't copy undefined or null, do copy empty string, 0, and false.
            if (value != null) {
                options[prop] = value
            }
        }
    }

    return options
}


/**
 * RequestArg effectively provides overloading for specifying request options
 * with a url string, an options object, or an existing RequestInfo.
 */
export type RequestArg = string | RequestOptions | RequestInfo

/**
 * RequestManager contains default options and methods to create requests.
 * This is an abstract base class--subclasses provide an implementation
 * specific to a platform such as Node.js or a web browser.
 */
export abstract class RequestManager extends Notifier<RequestListener> {

    protected defaultOptionsVar: RequestOptions = {}
    get defaultOptions() {
        return this.defaultOptionsVar
    }


    /**
     * Redirector is an operation that reacts to a 3xx response, e.g.,
     * retrying the request using the new location.
     */
    redirector: (r: RequestInfo, resolve, reject) => void

    /**
     * Authorizer is an operation that reacts to a 401 response, e.g.,
     * retrying the request after refreshing an authorization token.
     */
    authorizer: (r: RequestInfo, resolve, reject) => void


    /**
     * Send a request for the given argument and return a promise
     * fulfilled when the response is complete.
     */
    request(arg?: RequestArg): Promise<RequestInfo> {
        return this.requestForInfo(this.infoForArg(arg))
    }

    /**
     * Send a request using the given URL string and return a promise
     * fulfilled when the response is complete.
     */
    requestForUrl(url: string): Promise<RequestInfo> {
        return this.requestForInfo(this.infoForUrl(url))
    }

    /**
     * Send a request using the given options and return a promise
     * fulfilled when the response is complete.
     */
    requestForOptions(options: RequestOptions): Promise<RequestInfo> {
        return this.requestForInfo(this.infoForOptions(options))
    }

    /**
     * Send a request using the given options and return a promise
     * fulfilled when the response is complete.
     */
    abstract requestForInfo(r: RequestInfo): Promise<RequestInfo>


    /**
     * Get content from a resource specified by a URL or options.
     */
    get(arg?: RequestArg): Promise<RequestInfo> {
        return this.requestForInfo(this.info('GET', arg))
    }

    /**
     * Put content to a resource.
     */
    put(arg: RequestArg, body, type?: string): Promise<RequestInfo> {
        return this.requestForInfo(this.info('PUT', arg, body, type))
    }

    /**
     * Post content to a resource.
     */
    post(arg: RequestArg, body, type?: string): Promise<RequestInfo> {
        return this.requestForInfo(this.info('POST', arg, body, type))
    }

    /**
     * Patch content to a resource.
     */
    patch(arg: RequestArg, body, type?: string): Promise<RequestInfo> {
        return this.requestForInfo(this.info('PATCH', arg, body, type))
    }

    /**
     * Post contents as URL parameters to a resource.
     */
    postUrl<T extends object>(arg: RequestArg, body: T) : Promise<RequestInfo> {
        const r = this.info('POST', arg)

        const params = Object.keys(body).map((p) => p + '=' + encodeURI(body[p]))
        if (params.length) {
            r.options.search = '?' + params.join('&')
        }

        return this.requestForInfo(r)
    }

    /**
     * Delete a resource.
     */
    del(arg?: RequestArg, body?, type?: string): Promise<RequestInfo> {
        return this.requestForInfo(this.info('DELETE', arg, body, type))
    }


    /**
     * Return a new RequestInfo.
     */
    private info(m: string, arg?: RequestArg, body?, type?: string): RequestInfo {
        const r = this.infoForArg(arg)

        r.options.method = m
        if (body) {
            if (!type || type === mimeTypes.json) {
                r.requestBody = JSON.stringify(body)
                r.headerMod('content-type', mimeTypes.json)
            } else {
                // TODO: File uploads, multipart, chunked transfers
                r.headerMod('content-type', type)
                switch (typeof body) {
                case 'string':
                    r.requestBody = body
                    break

                case 'function':
                    r.requestBody = StringWriter.initial(body).buf
                    break

                default:
                    throw new Error('Unsupported body type ' + (typeof body))
                }
            }

            r.headerMod('content-length', r.requestBody.length)
        }

        return r
    }

    /**
     * Return a RequestInfo for a RequestArg that could be
     * a URL (string), options (RequestOptions), or a RequestInfo.
     */
    infoForArg(arg?: RequestArg): RequestInfo {
        if (arg) {
            if (arg instanceof RequestInfo) {
                return <RequestInfo>arg
            }

            if (typeof arg === 'string') {
                return this.infoForUrl(<string>arg)
            }
        }

        return this.infoForOptions(<RequestOptions>arg)
    }

    infoForUrl(url: string): RequestInfo {
        const opts = Object.assign({}, this.defaultOptionsVar)

        if (opts.url) {
            Object.assign(opts, this.optionsForUrl(opts.url))
            delete opts.url
        }

        Object.assign(opts, this.optionsForUrl(url))

        return this.initialInfo(opts)
    }

    infoForOptions(options?: RequestOptions): RequestInfo {
        const opts = Object.assign({}, this.defaultOptionsVar)

        if (opts.url) {
            Object.assign(opts, this.optionsForUrl(opts.url))
            delete opts.url
        }

        if (options) {
            const headers = opts.headers
            Object.assign(opts, options)
            if (headers && options.headers) {
                opts.headers = Object.assign({}, headers, options.headers)
            }
            if (options.url) {
                Object.assign(opts, this.optionsForUrl(options.url))
            }
        }

        return this.initialInfo(opts)
    }

    /**
     * Return a RequestInfo initialized with the given options.
     */
    private initialInfo(options: RequestOptions): RequestInfo {
        const r = this.newInfo()
        r.manager = this
        r.options = options
        r.locationList = null
        r.locationSet = null
        return r
    }

    /**
     * Subclasses implement the method to convert a URL string to a
     * corresponding options object.
     */
    abstract optionsForUrl(url: string): RequestOptions

    /**
     * Subclasses implement the method to create a new RequestInfo.
     */
    protected abstract newInfo(): RequestInfo

    protected handleSent(r: RequestInfo): void {
        super.post('requestSent', r)
    }

    protected handleRequestError(r: RequestInfo, err: Error, reject): void {
        super.post('requestError', r, err)
        reject(new HttpRequestError(r, err))
    }

    protected handleResponseError(r: RequestInfo, err: Error, reject): void {
        super.post('responseError', r, err)
        reject(new HttpResponseError(r, err))
    }

    /**
     * Common implementation logic for handling a complete response.
     */
    protected handleResponse(r: RequestInfo, s: number, resolve, reject): void {
        if (s >= 200 && s < 300) {
            super.post('requestSucceeded', r)
            resolve(r)
            return
        }

        if (s >= 300 && s < 400) {
            super.post('requestRedirected', r)
            if (this.redirector) {
                this.redirector(r, resolve, reject)
                return
            }
        } else if (s === 401 && this.authorizer) {
            super.post('requestUnauthenticated', r)
            if (this.authorizer) {
                this.authorizer(r, resolve, reject)
                return
            }
        }

        super.post('requestFailed', r)
        reject(new HttpStatusException(r))
    }

}

/**
 * Information about a request, including its response.
 *
 * This class is abstract to allow different implementations for
 * browser and non-browser environments.
 */
export abstract class RequestInfo {

    manager: RequestManager
    options: RequestOptions
    locationSet: Set<string>
    locationList: string[]

    get protocol() { return this.options.protocol }
    get hostname() { return this.options.hostname }
    get port() { return this.options.port }
    get host(): string {
        const options = this.options
        let s = options.hostname
        if (options.port) {
            s += ':' + options.port.toString()
        }
        return s
    }

    get method() { return this.options.method }
    get pathname() { return this.options.pathname }
    get search() { return this.options.search }
    get hash() { return this.options.hash }

    get path() {
        const options = this.options
        return options.pathname + (options.search || '') + (options.hash || '')
    }

    get timeout() { return this.options.timeout }

    /**
     * Return a header from options.
     */
    header(name: string): string {
        const headers = this.options.headers
        return headers ? headers[name] : null
    }

    /**
     * Modify a header in options. If the value is undefined or null
     * then remove the header. If there are no more headers then remove
     * the headers property.
     */
    headerMod(name: string, value?: string): void {
        const headers = this.options.headers
        if (value) {
            if (headers) {
                headers[name] = value
            } else {
                this.options.headers = {[name]: value}
            }
        } else if (headers) {
            delete headers[name]
            if (Object.keys(headers).length === 0) {
                delete this.options.headers
            }
        }
    }

    requestBody: any

    response: any

    /**
     * Return the value for a response header name or null if that header
     * was not in the response.
     */
    abstract responseHeader(name: string): string

    /** Return the type in the response or null if there was none. */
    abstract get responseType(): string

    /** Return the response status code. */
    abstract get statusCode(): number

    /** Return the response status as text. */
    abstract get statusText(): string

    /**
     * Return the response content as XML or null if either the response type
     * is not XML or the HTTP implementation does not provide XML parsing.
     */
    get responseXml(): any {
        return null
    }


    private responseBodyVar: string
    get responseBody() {
        return this.responseBodyVar
    }
    set responseBody(body) {
        this.responseBodyVar = body
        this.resultVar = undefined
    }

    private resultVar: any

    /**
     * Return an object representing the response content.
     *
     * If there is no content, the result is null. If the type is known then
     * try to convert it and if successful return the resulting object.
     * Otherwise, return the content as text.
     */
    get result(): any {
        let r = this.resultVar

        if (r === undefined) {
            r = this.computeResult()
            this.resultVar = r
        }

        return r
    }

    private computeResult(): any {
        const responseType = this.responseType
        if (!responseType) {
            return null
        }

        const content = this.responseBody
        const contentType = responseType.split(';')[0].toLowerCase()
        if (contentType === mimeTypes.json) {
            try {
                return JSON.parse(content)
            } catch (e) {
                return e
            }
        }

        for (const x of mimeTypes.xml) {
            if (contentType === x) {
                const xml = this.responseXml
                if (xml) {
                    return xml
                }
                break
            }
        }

        return content
    }

    /**
     * Convenience function to return a string describing a request.
     */
    get requestLabel(): string {
        const options = this.options
        const path = this.path
        const fullpath = path[0] === '/' ? path : ('/' + path)
        return options.method + ' ' + options.hostname + ' ' + fullpath
    }

    /**
     * Convenience function to return a string describing a response.
     */
    get responseLabel(): string {
        return this.requestLabel + ' ' + this.statusText
    }

    /**
     * Convenience function to return a string describing a result.
     */
    get resultLabel(): string {
        const result = this.result
        const text = this.responseLabel
        if (!result) {
            return text
        }

        let valueStr
        if (typeof result === 'string' || result instanceof String) {
            if (result.length === 0) {
                return text
            }

            const n = result.length - 1;
            if (result.charAt(n) === '\n') {
                valueStr = result.slice(0, n)
            } else {
                valueStr = result
            }
        } else if (Array.isArray(result)) {
            valueStr = result.join(',')
        } else if (result instanceof Object) {
            valueStr = JSON.stringify(result)
        } else {
            valueStr = result.toString()
        }

        return text + ' ' + valueStr
    }

}

class StringWriter {

    private bufVar: string = ''


    static initial(f?: (out: StringWriter) => void): StringWriter {
        const writer = new StringWriter()

        if (f) {
            f(writer)
        }

        return writer
    }


    get buf() {
        return this.bufVar
    }

    set buf(str) {
        this.bufVar = str
    }

    write(str): void {
        this.bufVar += str
    }

}


/**
 * Convenience class for managing cookies.
 */
export class CookieMap {

    private mapVar: Map<string,string>


    static initial(): CookieMap {
        const m = new CookieMap()
        m.mapVar = new Map<string,string>()
        return m
    }


    /**
     * Return a specific cookie.
     */
    cookie(name: string): string {
        return this.mapVar.get(name)
    }

    /**
     * Return a single string with all cookies that is suitable
     * as a cookie request header.
     */
    cookieHeader(): string {
        const allCookies = [];
        for (const [key, value] of this.mapVar) {
            allCookies.push(key + '=' + value)
        }
        return allCookies.join(';')
    }

    /**
     * Add a cookie to the map.
     */
    cookieAdd(name: string, value: string): void {
        this.mapVar.set(name, value)
    }

    /**
     * Add a single cookie parsing the header format.
     */
    cookieAddFromHeader(cookieHeader: string): void {
        if (cookieHeader) {
            let name = cookieHeader
            let value = ''

            const semicolon = cookieHeader.indexOf(';')
            if (semicolon >= 0) {
                name = cookieHeader.substring(0, semicolon)
                const equals = name.indexOf('=')
                if (equals >= 0) {
                    value = name.substring(equals + 1)
                    name = name.substring(0, equals)
                }
            }

            this.mapVar.set(name, value)
        }
    }

    /**
     * Merge given cookies from response headers into the cookie map.
     */
    cookieAddFromHeaders(cookies: Iterable<string>): void {
        if (cookies) {
            for (const c of cookies) {
                this.cookieAddFromHeader(c)
            }
        }
    }

}


export function manager(optImpl?: string): RequestManager {
    const impl = optImpl || defaultImpl()
    if (impl) {
        const cl = require(impl + '.js')['default']
        return new cl()
    }

    throw new Error('Unrecognized reqm environment')
}

export function defaultImpl(): string {
    if (typeof window !== 'undefined') {
        return './webreqm'
    }

    if (typeof module !== 'undefined' && module.exports != null) {
        return './nodereqm'
    }

    return undefined
}


let defaultManagerVar: RequestManager

export function defaultManager(): RequestManager {
    if (!defaultManagerVar) {
        defaultManagerVar = manager()
        defaultManagerVar.redirector = defaultRedirector
    }

    return defaultManagerVar
}

export default defaultManager

/**
 * Default redirection is to retry the request with the new location.
 */
export function defaultRedirector(r: RequestInfo, resolve, reject): void {
    if (r.method !== 'GET') {
        reject(new HttpStatusException(r))
        return
    }

    let s = r.locationSet
    if (!s) {
        const orig = r.protocol + '//' + r.host + r.path
        r.locationList = [orig]

        s = new Set<string>()
        s.add(orig)
        r.locationSet = s
    }

    const loc = r.responseHeader('location')
    if (s.has(loc)) {
        reject(new HttpRedirectLoop(r, loc))
        return
    }

    r.locationList.push(loc)
    s.add(loc)

    const m = r.manager
    Object.assign(r.options, m.optionsForUrl(loc))
    m.requestForInfo(r).then((r) => resolve(r), (err) => reject(err))
}

/**
 * HttpException is an Error subclass for exceptions thrown during
 * HTTP request and response processing.
 */
export class HttpException extends Error {

    protected infoVar: RequestInfo
    get info() {
        return this.infoVar
    }

    constructor(r: RequestInfo, message: string) {
        super(message)
        this.infoVar = r
    }

}

export class HttpRequestError extends HttpException {

    protected errVar: Error
    get err() {
        return this.errVar
    }

    constructor(r: RequestInfo, err: Error) {
        super(r, err.message)
        this.errVar = err
    }

}

export class HttpResponseError extends HttpException {

    protected errVar: Error
    get err() {
        return this.errVar
    }

    constructor(r: RequestInfo, err: Error) {
        super(r, err.message)
        this.errVar = err
    }

}

export class HttpStatusException extends HttpException {

    get code() {
        return this.infoVar.statusCode
    }


    constructor(r: RequestInfo) {
        super(r, 'HttpStatusException ' + r.statusCode.toString())
    }

}

export class HttpRedirectLoop extends HttpException {

    protected locationVar: string
    get location() {
        return this.locationVar
    }

    constructor(r: RequestInfo, loc: string) {
        super(r, 'HttpRedirectLoop: ' + loc)
        this.locationVar = loc
    }

}



/**
 * MIME types specific to common HTTP-based APIs.
 *
 * Yes, it might be better to depend on an external package that defines
 * MIME types. Unfortunately those define all MIME types in the universe,
 * where we really only need JSON and XML (and it isn't clear that
 * we really need XML).
 */
const mimeTypes = {
    "json": "application/json",
    "xml": [ "application/xml", "text/xml", "application/rss+xml" ]
}
