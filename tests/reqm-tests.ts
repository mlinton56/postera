import defaultManager from 'postera/reqm'
const reqm = defaultManager()

require('source-map-support').install()
process.on('unhandledRejection', function(err, p) { console.log(err.stack) })

async function main() {
    console.log((await reqm.get('https://duckduckgo.com')).result)
}

main()
