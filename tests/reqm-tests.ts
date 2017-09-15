import defaultManager from 'postera/reqm'
import { HttpStatusException } from 'postera/reqm'
const reqm = defaultManager()

require('source-map-support').install()
process.on('unhandledRejection', function(err, p) { console.log(err.stack) })

async function main() {
    reqm.defaultOptions.url = 'https://httpbin.org'
    try {
        //console.log((await reqm.get('/html')).result)
        //console.log((await reqm.get('/gzip')).result.gzipped)

        const data = {x: 3, y: 4}
        //console.log((await reqm.post('/post', data)).result.data)
        //console.log((await reqm.put('/put', data)).result.data)
        //console.log((await reqm.patch('/patch', data)).result.data)

        const headers = {'authorization': 'token'}
        console.log((await reqm.get(
            {pathname: '/headers', headers: {authorization: 'token'}}, data
        )).result.headers.Authorization)
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
