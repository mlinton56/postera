/**
 * Implementation of HttpService using Nodejs.
 */

import * as reqm from './reqm'

const nodeUrl = require('url')
const nodeHttp = require('http')
const nodeProto = {'http:': require('http'), 'https:': require('https')}

export default class NodeRequestManager extends reqm.RequestManager {

    newInfo(): reqm.RequestInfo {
        return new NodeRequestInfo()
    }

    optionsForUrl(url: string): reqm.RequestOptions {
        return reqm.urlOptions(nodeUrl.parse(url))
    }

    requestForInfo(r: reqm.RequestInfo): Promise<reqm.RequestInfo> {
        return new Promise<reqm.RequestInfo>((resolve, reject) => {
            const opts: any = Object.assign({}, r.options)
            opts.path = r.path
            const req = nodeProto[opts.protocol].request(opts, (response) => {
                r.response = response;

                const buffers = []
                response.on('data', (chunk) => buffers.push(chunk))

                response.on('error', (err) => {
                    r.responseBody = content(response.headers, buffers)
                    super.handleResponseError(r, err, reject)
                    clearNodeRequest(r)
                })

                response.on('end', () => {
                    r.responseBody = content(response.headers, buffers)
                    this.handleResponse(r, response.statusCode, resolve, reject)
                    clearNodeRequest(r)
                })
            })

            req.on('abort', () => {
                super.handleRequestCancellation(r, resolve)
                clearNodeRequest(r)
            })

            req.on('error', (err) => {
                super.handleRequestError(r, err, reject)
                clearNodeRequest(r)
            })

            const body = r.requestBody
            if (body) {
                if (typeof body === 'function') {
                    body(req)
                } else {
                    req.write(body)
                }
            }
            req.end()

            saveNodeRequest(r, req)

            super.handleSent(r)
        })
    }

    cancellation(r: reqm.RequestInfo): reqm.RequestInfo {
        const req = nodeInfo(r).nodeRequest
        if (req) {
            req.abort()
        }

        return r
    }

}

function saveNodeRequest(r: reqm.RequestInfo, req): void {
    nodeInfo(r).nodeRequest = req
}

function clearNodeRequest(r: reqm.RequestInfo): void {
    nodeInfo(r).nodeRequest = null
}

function nodeInfo(r: reqm.RequestInfo): NodeRequestInfo {
    return <NodeRequestInfo>r
}


class NodeRequestInfo extends reqm.RequestInfo {

    nodeRequest: any

    responseHeader(name: string): string {
        return this.response.headers[name]
    }

    get responseType() {
        return this.response.headers['content-type']
    }

    get statusCode() {
        return this.response.statusCode
    }

    get statusText() {
        return nodeProto['http:'].STATUS_CODES[this.response.statusCode];
    }

}

const zlib = require('zlib')

function content(headers: string[], buffers: Buffer[]): string {
    var buf = Buffer.concat(buffers);

    const encoding = headers['content-encoding'];
    if (encoding) {
        switch (encoding.toLowerCase()) {
        case 'gzip':
            buf = zlib.unzipSync(buf)
            break

        case 'deflate':
            buf = zlib.inflateSync(buf)
            break
        }
    }

    return buf.toString()
}
