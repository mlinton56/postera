/**
 * Implementation of RequestManager using XMLHttpRequest.
 */

import * as reqm from './reqm'

export default class WebRequestManager extends reqm.RequestManager {

    newInfo(): reqm.RequestInfo {
        return new WebRequestInfo()
    }

    optionsForUrl(url: string): reqm.RequestOptions {
        const u = new URL(url)
        return {
            protocol: u.protocol,
            hostname: u.hostname,
            port: u.port ? JSON.parse(u.port) : undefined,
            pathname: u.pathname,
            search: u.search,
            hash: u.hash
        }
    }

    send(r: reqm.RequestInfo): Promise<reqm.RequestInfo> {
        const options = r.options
        const req = new XMLHttpRequest()
        const url = options.protocol + '//' + r.host + r.path
        req.open(options.method, url)

        const headers = options.headers
        if (headers) {
            for (const h of Object.keys(headers)) {
                req.setRequestHeader(h, headers[h])
            }
        }

        return new Promise<reqm.RequestInfo>((resolve, reject) => {
            req.addEventListener('load', (event) => {
                r.response = req
                r.responseBody = req.response

                const statusCode = req.status
                if (statusCode >= 200 && statusCode < 300) {
                    this.postNotification('requestSucceeded', r)
                    resolve(r)
                } else if (statusCode >= 300 && statusCode < 400) {
                    this.postNotification('requestRedirected', r)
                    if (this.redirector) {
                        this.redirector(r, resolve, reject)
                    } else {
                        reject(new reqm.HttpStatusException(r))
                    }
                } else {
                    this.postNotification('requestFailed', r)
                    reject(new reqm.HttpStatusException(r))
                }
            }, false)

            req.addEventListener('error', (event) => {
                const err = new Error(event.type)
                this.postNotification('requestError', r, err)
                reject(new reqm.HttpRequestError(err))
            }, false)

            req.addEventListener('abort', (event) => {
                const err = new Error(event.type)
                this.postNotification('responseError', r, err)
                reject(new reqm.HttpResponseError(err))
            }, false)

            req.addEventListener('timeout', (event) => {
                const err = new Error(event.type)
                this.postNotification('responseError', r, err)
                reject(new reqm.HttpResponseError(err))
            }, false)

            const body = r.requestBody
            if (body) {
                if (typeof body === 'function') {
                    const writer = StringWriter.initial()
                    body(writer)
                    req.send(writer.buf)
                } else {
                    req.send(body)
                }
            } else {
                req.send()
            }

            this.postNotification('requestSent', r)
        })
    }

}

class WebRequestInfo extends reqm.RequestInfo {

    responseHeader(name: string) {
        return this.response.getResponseHeader(name)
    }

    get responseType() {
        return this.response.getResponseHeader("Content-Type")
    }

    get responseXml() {
        return this.response.responseXML
    }

    get statusCode() {
        return this.response.status
    }

    get statusText() {
        return this.response.statusText
    }

}

class StringWriter {

    private bufVar: string


    static initial(): StringWriter {
        const writer = new StringWriter()
        writer.bufVar = ''
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
