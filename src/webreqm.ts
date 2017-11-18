/**
 * Implementation of RequestManager using XMLHttpRequest.
 */

import * as reqm from './reqm'

export default class WebRequestManager extends reqm.RequestManager {

    newInfo(): reqm.RequestInfo {
        return new WebRequestInfo()
    }

    optionsForUrl(url: string): reqm.RequestOptions {
        return reqm.urlOptions(new URL(url))
    }

    requestForInfo(r: reqm.RequestInfo): Promise<reqm.RequestInfo> {
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
        return this.response.status
    }

    get statusText() {
        return this.response.statusText
    }

}
