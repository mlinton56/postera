/**
 * Implementation of RequestManager using XMLHttpRequest.
 */

import * as reqm from './reqm'

//
// Derived from URI Generic Syntax regular expression in RFC 3986,
// with tweaks to split out the port and avoid some capturing.
//
const uriPattern = (
    '^([^:/?#]+:)?' +           // [1] protocol
    '(?://([^/?#:]*))?' +       // [2] hostname
    '(?::([0-9]+))?' +          // [3] port
    '([^?#]+)?' +               // [4] pathname
    '(\\?[^#]*)?' +             // [5] search
    '(#.*)?'                    // [6] hash
)

const uriRegExp = new RegExp(uriPattern)

const forbiddenHeaderSet = (function() {
    const s = new Set<string>()
    for (const h of ['content-length', 'cookie', 'origin', 'keep-alive']) {
        s.add(h)
    }
    return s
})()

export default class WebRequestManager extends reqm.RequestManager {

    newInfo(): reqm.RequestInfo {
        return new WebRequestInfo()
    }

    optionsForUrl(str: string): reqm.RequestOptions {
        const match = str.match(uriRegExp)
        if (match) {
            return reqm.urlOptions({
                protocol: match[1],
                hostname: match[2] ? match[2] : undefined,
                port: match[3] && parseInt(match[3]),
                pathname: match[4] || (match[2] && '/'),
                search: match[5],
                hash: match[6]
            })
        }

        throw new Error('URL syntax error')
    }

    requestForInfo(r: reqm.RequestInfo): Promise<reqm.RequestInfo> {
        const options = r.options
        const req = new XMLHttpRequest()
        const url = options.protocol + '//' + r.host + r.path
        req.open(options.method, url)

        const headers = options.headers
        if (headers) {
            for (const h of Object.keys(headers)) {
                if (!forbiddenHeaderSet.has(h)) {
                    req.setRequestHeader(h, headers[h])
                }
            }
        }

        return new Promise<reqm.RequestInfo>((resolve, reject) => {
            req.addEventListener('load', (event) => {
                r.response = req
                r.responseBody = req.response
                this.handleResponse(r, req.status, resolve, reject)
                clearWebRequest(r)
            }, false)

            req.addEventListener('error', (event) => {
                const err = new Error(event.type)
                super.handleRequestError(r, new Error(event.type), reject)
                clearWebRequest(r)
            }, false)

            req.addEventListener('abort', (event) => {
                const err = new Error(event.type)
                super.handleResponseError(r, new Error(event.type), reject)
                clearWebRequest(r)
            }, false)

            req.addEventListener('timeout', (event) => {
                const err = new Error(event.type)
                super.handleResponseError(r, new Error(event.type), reject)
                clearWebRequest(r)
            }, false)

            if (r.requestBody) {
                req.send(r.requestBody)
            } else {
                req.send()
            }

            saveWebRequest(r, req)

            super.handleSent(r)
        })
    }

    cancellation(r: reqm.RequestInfo): reqm.RequestInfo {
        const req = webInfo(r).webRequest
        if (req) {
            req.abort()
        }

        return r
    }

}

function saveWebRequest(r: reqm.RequestInfo, req): void {
    webInfo(r).webRequest = req
}

function clearWebRequest(r: reqm.RequestInfo): void {
    webInfo(r).webRequest = null
}

function webInfo(r: reqm.RequestInfo): WebRequestInfo {
    return <WebRequestInfo>r
}


class WebRequestInfo extends reqm.RequestInfo {

    webRequest: any

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
        return this.webRequest.status
    }

    get statusText() {
        return this.webRequest.statusText
    }

}
