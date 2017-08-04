/**
 * Module that provides a key-value store interface with an implementation
 * that uses a Redis server.
 */

import logger from './slogger'

const redis = require('redis')

export interface KeyValueStore {
    impl: any

    value(key: string): Promise<any>
    strValue(key: string): Promise<string>

    valueMod(key: string, value: any): Promise<void>
    strValueMod(key: string, value: string): Promise<void>

    valueIncr(key: string): Promise<number>
    valueDel(keys: string[]): Promise<number>
    valueDelAfter(key: string, seconds: number): Promise<boolean>

    map<T extends object>(key: string): Promise<T>
    mapMod<T extends object>(key: string, changes: T): Promise<void>
    mapDel(key: string, i: string[]): Promise<number>
    mapSize(key: string): Promise<number>
    mapItem(key: string, i: string): Promise<any>
    mapItemMod(key: string, i: string, value: any): Promise<boolean>
    mapItemIncr(key: string, i: string): Promise<number>

    strMap<T extends object>(key: string): Promise<T>
    strMapMod<T extends object>(key: string, changes: T): Promise<void>
    strMapItem(key: string, i: string): Promise<string>
    strMapItemMod(key: string, i: string, value: string): Promise<boolean>
}

export function redisStore(config): KeyValueStore {
    const store = new RedisStore()
    store.impl = redis.createClient(config)
    logger.info('Redis server is ' + config.host)
    return store
}


export type Result = (err, res) => void

export class RedisStore implements KeyValueStore {

    impl: any

    value(key: string): Promise<any> {
        return new Promise<any>((resolve, reject) =>
            this.impl.get(key, parseResult(resolve, reject))
        )
    }

    strValue(key: string): Promise<string> {
        return new Promise<any>((resolve, reject) =>
            this.impl.get(key, result(resolve, reject))
        )
    }

    valueMod(key: string, value: any): Promise<void> {
        return new Promise<void>((resolve, reject) =>
            this.impl.set(key, JSON.stringify(value), voidResult(resolve, reject))
        )
    }

    strValueMod(key: string, value: string): Promise<void> {
        return new Promise<void>((resolve, reject) =>
            this.impl.set(key, value, voidResult(resolve, reject))
        )
    }

    valueIncr(key: string): Promise<number> {
        return new Promise<number>((resolve, reject) =>
            this.impl.incr(key, parseResult(resolve, reject))
        )
    }

    valueDel(keys: string[]): Promise<number> {
        return new Promise<number>((resolve, reject) =>
            this.impl.del(...keys, parseResult(resolve, reject))
        )
    }

    valueDelAfter(key: string, seconds: number): Promise<boolean> {
        return new Promise<boolean>((resolve, reject) =>
            this.impl.expire(key, seconds, (err, res) => {
                err ? reject(err) : resolve(res == 1)
            })
        )
    }

    map(key: string): Promise<any> {
        return new Promise<any>((resolve, reject) => {
            this.impl.hgetall(key, (err, res) => {
                if (err) {
                    reject(err)
                } else {
                    try {
                        const items = {}
                        if (res) {
                            for (let k of Object.keys(res)) {
                                items[k] = JSON.parse(res[k])
                            }
                        }
                        resolve(items)
                    } catch (e) {
                        reject(e)
                    }
                }
            })
        })
    }

    mapMod<T extends object>(key: string, changes: T): Promise<void> {
        const fields = Object.keys(changes)
        if (fields.length === 1) {
            const name = fields[0]
            const value = JSON.stringify(changes[name])
            return new Promise<void>((resolve, reject) =>
                this.impl.hset(key, name, value, voidResult(resolve, reject))
            )
        } else {
            let args = []
            for (let f of fields) {
                args.push(f)
                args.push(JSON.stringify(changes[f]))
            }

            return new Promise<void>((resolve, reject) =>
                this.impl.hmset(key, ...args, voidResult(resolve, reject))
            )
        }
    }

    mapDel(key: string, i: string[]): Promise<number> {
        return new Promise<any>((resolve, reject) =>
            this.impl.hdel(key, ...i, parseResult(resolve, reject))
        )
    }

    mapSize(key: string): Promise<number> {
        return new Promise<number>((resolve, reject) =>
            this.impl.hlen(key, parseResult(resolve, reject))
        )
    }

    mapItem(key: string, i: string): Promise<any> {
        return new Promise<any>((resolve, reject) =>
            this.impl.hget(key, i, parseResult(resolve, reject))
        )
    }

    mapItemMod(key: string, i: string, value: any): Promise<boolean> {
        return new Promise<boolean>((resolve, reject) =>
            this.impl.hset(key, i, JSON.stringify(value), (err, res) => 
                err ? reject(err) : resolve(res == 1)
            )
        )
    }

    mapItemIncr(key: string, i: string): Promise<number> {
        return new Promise<number>((resolve, reject) =>
            this.impl.hincrby(key, i, 1, parseResult(resolve, reject))
        )
    }

    strMap(key: string): Promise<any> {
        return new Promise<any>((resolve, reject) =>
            this.impl.hgetall(key, result(resolve, reject))
        )
    }

    strMapMod<T extends object>(key: string, changes: T): Promise<void> {
        const fields = Object.keys(changes)
        if (fields.length === 1) {
            const name = fields[0]
            const value = changes[name]
            return new Promise<void>((resolve, reject) =>
                this.impl.hset(key, name, value, voidResult(resolve, reject))
            )
        } else {
            let args = []
            for (let f of fields) {
                args.push(f)
                args.push(changes[f])
            }

            return new Promise<void>((resolve, reject) =>
                this.impl.hmset(key, ...args, voidResult(resolve, reject))
            )
        }
    }

    strMapItem(key: string, i: string): Promise<string> {
        return new Promise<string>((resolve, reject) =>
            this.impl.hget(key, i, result(resolve, reject))
        )
    }

    strMapItemMod(key: string, i: string, value: string): Promise<boolean> {
        return new Promise<boolean>((resolve, reject) =>
            this.impl.hset(key, i, value, (err, res) => 
                err ? reject(err) : resolve(res == 1)
            )
        )
    }

}

function result(resolve, reject): Result {
    return (err, res) => err ? reject(err) : resolve(res)
}

function parseResult(resolve, reject): Result {
    return (err, res) => {
        if (err) {
            reject(err)
        } else {
            try {
                resolve(res ? JSON.parse(res) : null)
            } catch (e) {
                reject(e instanceof Error ? <Error>e: new Error(e.toString()))
            }
        }
    }
}

function voidResult(resolve, reject): Result {
    return (err, res) => err ? reject(err) : resolve()
}
