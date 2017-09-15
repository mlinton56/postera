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
        const u = nodeUrl.parse(url)

        // Node options use 'path' instead of 'pathname' so we assign both here.
        return {
            protocol: u.protocol,
            hostname: u.hostname,
            port: u.port,
            pathname: u.pathname,
            search: u.search,
            hash: u.hash
        }
    }

    send(r: reqm.RequestInfo): Promise<reqm.RequestInfo> {
        return new Promise<reqm.RequestInfo>((resolve, reject) => {
            const opts: any = Object.assign({}, r.options)
            opts.path = r.path
            const req = nodeProto[opts.protocol].request(opts, (response) => {
                this.postNotification('requestSent', r)
                r.response = response;

                const buffers = []
                response.on('data', (chunk) => buffers.push(chunk))

                response.on('error', (err) => {
                    r.responseBody = content(response.headers, buffers)
                    this.postNotification('requestError', r, err)
                    reject(new reqm.HttpRequestError(err))
                })

                response.on('end', () => {
                    r.responseBody = content(response.headers, buffers)

                    const statusCode = response.statusCode;
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
                    } else if (statusCode === 401 && this.authorizer) {
                        this.authorizer(r, resolve, reject)
                    } else {
                        this.postNotification('requestFailed', r)
                        reject(new reqm.HttpStatusException(r))
                    }
                })
            })

            req.on('error', (err) => {
                this.postNotification('requestError', r, err)
                reject(new reqm.HttpRequestError(err))
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
        })
    }

}

class NodeRequestInfo extends reqm.RequestInfo {

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
        return nodeProto['http'].STATUS_CODES[this.response.statusCode];
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
