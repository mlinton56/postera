import defaultManager from 'postera/reqm'
import { RequestInfo, RequestListener, HttpStatusException } from 'postera/reqm'

require('source-map-support').install()
process.on('unhandledRejection', function(err, p) { console.log(err.stack) })

class Listener implements RequestListener {

    requestSent(r: RequestInfo): void {
        console.log('requestSent: ' + r.requestLabel)
    }

    requestRedirected(r: RequestInfo): void {
        console.log('requestRedirected ' + r.responseHeader('location'))
    }

    requestSucceeded(r: RequestInfo): void {
        console.log('requestSucceeded: ' + r.responseLabel)
    }

    requestFailed(r: RequestInfo): void {
        console.log('requestFailed: ' + r.responseLabel)
    }

    requestError(r: RequestInfo): void {
        console.log('requestError: ' + r.requestLabel)
    }

    responseError(r: RequestInfo): void {
        console.log('responseError: ' + r.responseLabel)
    }

}

async function main() {
    const reqm = defaultManager()
    reqm.defaultOptions.url = 'https://httpbin.org'
    try {
        console.log((await reqm.get('/html')).result)
        console.log((await reqm.get('/gzip')).result.gzipped)

        const data = {x: 3, y: 4}
        console.log((await reqm.post('/post', data)).result.data)
        console.log((await reqm.put('/put', data)).result.data)

        reqm.listenerAdd(new Listener())
        console.log((await reqm.patch('/patch', data)).result.data)
        // 301 test
        await reqm.get('http://google.com')
        reqm.listenerDelAll()


        const options = {pathname: '/headers', headers: {authorization: 'token'}}
        console.log((await reqm.get(options)).result.headers.Authorization)
    } catch (e) {
        if (e instanceof HttpStatusException) {
            const ex = <HttpStatusException>e
            console.log('HttpStatusException: ' + ex.code)
        } else {
            console.log(e.toString())
        }
    }
}

main()
