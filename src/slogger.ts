/**
 * Shared logging implementation.
 *
 * Copyright (c) 2017 Mark A. Linton
 *
 * Use of this source code is governed by the MIT-style license that is
 * in the LICENSE file or at https://opensource.org/licenses/MIT.
 *
VERSION 0.1.0
README
EOF
 */

import fs = require('fs')

export enum Level {
    trivial, verbose, debug, info, warn, error, panic
}

/**
 * SimpleLogger defines an interface common to most logging libraries,
 * winston in particular.
 */
export interface SimpleLogger {
    level: string

    log(level: string, msg: string, ...args: any[]): SimpleLogger
    error(msg: string | Error, ...args: any[]): SimpleLogger
    warn(msg: string | Error, ...args: any[]): SimpleLogger
    info(msg: string | Error, ...args: any[]): SimpleLogger
    debug(msg: string | Error, ...args: any[]): SimpleLogger
    verbose(msg: string | Error, ...args: any[]): SimpleLogger
}

/**
 * BaseLogger is an abstract class that adds shorthand for common log levels,
 * as well as automatically converting an Error to a string as the message.
 */
export abstract class BaseLogger implements SimpleLogger {

    abstract level: string
    abstract log(level: string, msg: string, ...args: any[]): SimpleLogger


    errStackFlag: boolean = true


    error(msg: string | Error, ...args: any[]): SimpleLogger {
        return this.log('error', convert(msg, this), ...args)
    }

    warn(msg: string | Error, ...args: any[]): SimpleLogger {
        return this.log('warn', convert(msg, this), ...args)
    }

    info(msg: string | Error, ...args: any[]): SimpleLogger {
        return this.log('info', convert(msg, this), ...args)
    }

    debug(msg: string | Error, ...args: any[]): SimpleLogger {
        return this.log('debug', convert(msg, this), ...args)
    }

    verbose(msg: string | Error, ...args: any[]): SimpleLogger {
        return this.log('verbose', convert(msg, this), ...args)
    }

}

function convert(msg: string | Error, logger: BaseLogger): string {
    if (typeof msg === 'string') {
        return <string>msg
    }

    const err = <Error>msg
    return logger.errStackFlag ? err.stack : err.message
}

/**
 * ProxyLogger is a SimpleLogger implementation that relies on another
 * logger implementation. This delegation allows a module user to import
 * the default object (a proxy logger) and use it after another module
 * changes the implementation.
 */
export class ProxyLogger extends BaseLogger {

    private implVar: SimpleLogger
    get impl(): SimpleLogger { return this.implVar }
    set impl(impl: SimpleLogger) {
        this.implVar = impl
    }

    get level() { return this.implVar.level }
    set level(level: string) { this.implVar.level = level }

    log(level: string, msg: string | Error, ...args: any[]): SimpleLogger {
        return this.implVar.log(level, convert(msg, this), ...args)
    }

}


const defaultConfig = {
    timeFlag: true,
    levelFlag: true,
    errStackFlag: true,
    consoleFlag: true
}

/**
 * ConfigurableLogger adds a config property to configure logger behavior.
 *
 * Note that one cannot configure through a proxy logger. A caller must
 * extract the implementation and cast it, e.g.,
 *
 *    import { defaultLogger as logger, ConfigurableLogger } from 'slogger'
 *    const cfg = <ConfigurableLogger>(logger.impl)
 */
export abstract class ConfigurableLogger extends BaseLogger {

    private configVar: any
    get config() { return this.configVar }
    set config(config: any) {
        this.configVar = Object.assign({}, defaultConfig, config)
        this.configModified()
    }

    abstract configModified(): void

}

class FileLogger extends ConfigurableLogger {

    level: string
    private curlevel: number
    private file = -1
    private timestamp = 0

    configModified(): void {
        const cfg = this.config
        this.level = cfg.level || 'info'
        this.curlevel = Level[this.level]
        this.errStackFlag = cfg.errStackFlag

        if (cfg.file) {
            this.file = fs.openSync(cfg.file, 'a')
            this.info('Logging to ' + cfg.file)
        }
    }

    log(level: string, msg: string | Error, ...args: any[]): SimpleLogger {
        if (Level[level] < this.curlevel) {
            return
        }

        const cfg = this.config

        let str = convert(msg, this)
        for (let a of args) {
            str += ' ' + a.toString()
        }

        if (cfg.levelFlag) {
            str = level + ': ' + str
        }

        if (cfg.timeFlag) {
            const now = new Date()

            const two = '00'
            const hours = paddedString(now.getHours(), two)
            const mins = paddedString(now.getMinutes(), two)
            const secs = paddedString(now.getSeconds(), two)
            const msecs = paddedString(now.getMilliseconds(), '000')
            const timeStr = hours + ':' + mins + ':' + secs + '.' + msecs

            const ts = now.valueOf()
            if (ts - this.timestamp >= 10*60*1000) {
                const dateTime = now.toLocaleString()
                this.writeLog(cfg, timeStr + ' Date and time is ' + dateTime)
            }
            this.timestamp = ts
            str = timeStr + ' ' + str
        }

        this.writeLog(cfg, str)

        return this
    }

    /**
     * Write a line to the log.
     */
    private writeLog(cfg: any, line: string): void {
        if (this.file >= 0) {
            fs.writeSync(this.file, line + '\n')
        }

        if (cfg.consoleFlag) {
            console.log(line)
        }
    }

}

/**
 * Return a printable day of the week for the given day for logging.
 *
 * TODO: Localization.
 */
function dayOfWeek(day: number): string {
    return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][day]
}

/**
 * Return a number padded at the beginning using the given padding string,
 * e.g. paddedString(7, '000') returns '007'.
 */
function paddedString(n: number, padding: string) {
    return (padding + n.toString()).slice(-(padding.length))
}


export function proxyLogger(logger: SimpleLogger): ProxyLogger {
    const proxy = new ProxyLogger()
    proxy.impl = logger
    return proxy
}

export function fileLogger(config?: any): BaseLogger {
    const logger = new FileLogger()
    logger.config = config
    return logger
}

export const defaultLogger = proxyLogger(fileLogger())

export default defaultLogger
