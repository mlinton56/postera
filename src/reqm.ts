/**
 * Module for managing HTTP requests to a service.
 *
 * Copyright (c) 2017 Mark A. Linton
 *
 * Use of this source code is governed by the MIT-style license that is
 * in the LICENSE file or at https://opensource.org/licenses/MIT.
VERSION 0.1.0
README
## reqm

The reqm module provides an interface to make HTTP requests in either
Node.js or browser environment that return a promise
of a RequestInfo instance. This approach allows one to use await
to block until the request completes. Requests specify options
with a URL string or an object that conforms to the RequestOptions interface.

    import defaultManager from 'postera/reqm'
    const reqm = defaultManager()

    let r = await reqm.get('http://duckduckgo.com')
    console.log(r.result)

    r = await reqm.post({url: 'https://duckduckgo.com/?q=foo&t=hw&ia=web'})

The default object in the reqm module is a RequestManager instance
specific to the execution environment (Node.js or web browser). This object
contains a default set of request options that the request argument overrides.

    reqm.defaultOptions.protocol = 'https'
    reqm.defaultOptions.hostname = 'myhost.com'
    reqm.defaultOptions.headers = {'authorization': accessToken}
    r = await reqm.get({pathname: '/a'})
    r = await reqm.get({pathname: '/b'})

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

export type RequestArg = string | RequestOptions

/**
 * RequestManager contains default options and methods to create requests.
 * This is an abstract base class--subclasses provide an implementation
 * specific to a platform such as Node.js or a web browser.
 */
export abstract class RequestManager extends Notifier<RequestListener> {

    protected defaultOptionsVar: RequestOptions
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
     * Send a request with the given options overriding the default ones.
     */
    request(arg?: RequestArg): Promise<RequestInfo> {
        return this.send(this.infoForArg(arg))
    }

    /**
     * Get content from a resource specified by a URL or options.
     */
    get(arg: RequestArg): Promise<RequestInfo> {
        return this.send(this.info('GET', arg))
    }

    /**
     * Put content to a resource.
     */
    put(arg: RequestArg, body, type?: string): Promise<RequestInfo> {
        return this.send(this.info('PUT', arg, body, type))
    }

    /**
     * Post content to a resource.
     */
    post(arg: RequestArg, body, type?: string): Promise<RequestInfo> {
        return this.send(this.info('POST', arg, body, type))
    }

    /**
     * Patch content to a resource.
     */
    patch(arg: RequestArg, body, type?: string): Promise<RequestInfo> {
        return this.send(this.info('PATCH', arg, body, type))
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

        return this.send(r)
    }

    /**
     * Delete a resource.
     */
    del(arg: RequestArg, body?, type?: string): Promise<RequestInfo> {
        return this.send(this.info('DELETE', arg, body, type))
    }


    /**
     * Return a new RequestInfo.
     */
    private info(m: string, arg: RequestArg, body?, type?: string): RequestInfo {
        const r = this.infoForArg(arg)

        r.options.method = m
        if (body) {
            if (!type || type === mimeTypes.json) {
                r.requestBody = JSON.stringify(body)
                r.headerMod('content-type', mimeTypes.json)
            } else {
                r.requestBody = body
                r.headerMod('content-type', type)
            }
        }

        return r
    }

    /**
     * Return a new RequestInfo for either a URL (string) or options parameter,
     * adding to this manager's default options.
     */
    private infoForArg(arg?: RequestArg): RequestInfo {
        const opts = Object.assign({}, this.defaultOptionsVar)

        if (opts.url) {
            Object.assign(opts, this.optionsForUrl(opts.url))
            delete opts.url
        }

        if (typeof arg === 'string') {
            Object.assign(opts, this.optionsForUrl(<string>arg))
        } else if (arg) {
            const argOpts = <RequestOptions>arg
            const headers = opts.headers
            Object.assign(opts, argOpts)
            if (headers && opts.headers) {
                opts.headers = Object.assign({}, headers, opts.headers)
            }
            if (argOpts.url) {
                Object.assign(opts, this.optionsForUrl(argOpts.url))
                delete opts.url
            }
        }

        const r = this.newInfo()
        r.manager = this
        r.options = opts

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

    /**
     * Platform-specific subclasses implement a method to send a request and
     * receive a response embedded in the resolved RequestInfo value.
     */
    protected abstract send(r: RequestInfo): Promise<RequestInfo>

    /**
     * Notifier defines a post method but we use that name for the HTTP method.
     */
    protected postNotification = super.post

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

    get path(): string {
        const options = this.options
        return options.pathname + options.search + options.hash
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
        return options.method + ' ' + options.hostname + fullpath
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


const implMap = new Map<string,RequestManager>()

export function manager(impl: string): RequestManager {
    let m = implMap.get(impl)

    if (!m) {
        const cl = require(impl + '.js')['default']
        m = new cl()
        implMap[impl] = m
    }

    return m
}

let defaultManagerVar: RequestManager

export default function defaultManager(): RequestManager {
    if (!defaultManagerVar) {
        let impl
        if (typeof window !== 'undefined') {
            impl = './webreqm'
        } else if (typeof module !== 'undefined' && module.exports != null) {
            impl = './nodereqm'
        } else {
            throw new Error('Unrecognized RequestManager environment')
        }

        defaultManagerVar = manager(impl)
        defaultManagerVar.redirector = defaultRedirector
    }

    return defaultManagerVar
}

/**
 * Default redirection is to retry the request with the new location.
 *
 * TODO: Handle relative locations and redirection loops.
 */
export function defaultRedirector(r: RequestInfo, resolve, reject): void {
    const opts = this.optionsForUrl(r.responseHeader('location'))
    this.request(opts).then((r) => resolve(r), (err) => reject(err))
}

/**
 * HttpException is an Error subclass for exceptions thrown during
 * HTTP request and response processing.
 */
export class HttpException extends Error {

    constructor(message: string) {
        super(message)
    }

}

export class HttpRequestError extends HttpException {

    private errVar: Error
    get err() {
        return this.errVar
    }

    constructor(err: Error) {
        super(err.message)
        this.errVar = err
    }

}

export class HttpResponseError extends HttpException {

    private errVar: Error
    get err() {
        return this.errVar
    }

    constructor(err: Error) {
        super(err.message)
        this.errVar = err
    }

}

export class HttpStatusException extends HttpException {

    private infoVar: RequestInfo
    get info() {
        return this.info
    }

    get code() {
        return this.info.statusCode
    }


    constructor(r: RequestInfo) {
        super('HttpStatusException')
        this.infoVar = r
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
