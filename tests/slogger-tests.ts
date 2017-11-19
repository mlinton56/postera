import * as slogger from 'postera/slogger'

require('source-map-support').install()
process.on('unhandledRejection', (err, p) => console.log(err.stack))

const logger = slogger.defaultLogger

logger.info('This is a test')
logger.debug('Not yet')
logger.level = 'debug'
logger.debug('Now')

const flogger = slogger.fileLogger({
    file: 't.log', timeFlag: false, levelFlag: false
})
flogger.info('This is a file test')
