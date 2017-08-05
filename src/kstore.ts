/**
 * Module that provides a key-value store interface with an implementation
 * that uses a Redis server.
 *
 * Copyright (c) 2017 Mark A. Linton
 *
 * Use of this source code is governed by the MIT-style license that is
 * in the LICENSE file or at https://opensource.org/licenses/MIT.
 *
VERSION 0.1.0
README
## kstore

The kstore module provides common methods to access a shared key-value store,
with an implementation for Redis. The methods are promise-based
to simplify coding synchronous use cases.

The method interfaces support associating strings or objects with a string key,
as well as maps of strings or objects accessed by an item identifier (string).

    import * as kstore from 'postera/kstore'

    // Access a key-value store with a given configuration.
    const store = kstore.redisStore({host: 'localhost'})

    // Modify the value associated with a key.
    await store.valueMod('object', {a: 3, b: 4})

    // Access the associated value, which is {a: 3, b: 4}.
    const obj = await store.value('object')

    // Delete an association
    await store.valueDel('object')

Note that values are normally converted to and from strings with
JSON.stringify and JSON.parse. To avoid conversion use string values:

    await store.strValueMod('object', 'this is a string')

#### Maps

A map is like another value (it can be deleted with valueDel, for example)
but allows access by item without retrieving the full map.

    // Associate a map.
    await store.mapMod('map', {a: 3, b: 4})

    //
    // Access an item without getting the entire map. In this case
    // the return value is 3.
    //
    await store.mapItem('map', 'a')

    // Modify an item within a map.
    if (await store.mapItemMod('map', 'c', 5)) {
        // Returns true if the item is new to the map.
    }

    // Access the entire map at once--this returns {a: 3, b: 4}.
    await store.map('map')

As with values, map items are normally converted to and from strings
with JSON.stringify and JSON.parse. To avoid conversion use string maps:

    await store.strMapMod('map', {'a': 'a string', b: 'b string'})
    await store.strMapItem('map', 'a')
    await store.strMapItemMod('map', 'c', 'c string')
    await store.strMap('map')
EOF
 *
 */

import logger from './slogger'

const redis = require('redis')

/**
 * Access to a shared (potentially remote) key-value store.
 */
export interface KeyValueStore {
    /** Implementation, e.g. Redis client object. */
    impl: any

    /**
     * Return the object value associated with a key. May use JSON.parse
     * to convert from a string in some store implementations.
     */
    value(key: string): Promise<any>

    /** Return the string value associated with a key. */
    strValue(key: string): Promise<string>

    /** Modify the object value associated with a key. */
    valueMod(key: string, value: any): Promise<void>

    /** Modify the string value associated with a key. */
    strValueMod(key: string, str: string): Promise<void>

    /** Increment an integer associated with a key and return the new value. */
    valueIncr(key: string): Promise<number>

    /**
     * Delete the association for one or more keys, returning the number
     * of keys that were deleted.
     */
    valueDel(...keys: string[]): Promise<number>

    /**
     * Schedule the deletion of an association to a key after a given number
     * of seconds. Returns whether the key currently has an association.
     */
    valueDelAfter(key: string, seconds: number): Promise<boolean>

    /** Return the map associated with a key. */
    map<T extends object>(key: string): Promise<T>

    /** Modify the map associated with a key. */
    mapMod<T extends object>(key: string, changes: T): Promise<void>

    /** Delete one or more items from a map, returning the number deleted. */
    mapDel(key: string, ...i: string[]): Promise<number>

    /** Return the number of items in a map. */
    mapSize(key: string): Promise<number>

    /** Return an item in a map. */
    mapItem(key: string, i: string): Promise<any>

    /** Modify an item in a map. */
    mapItemMod(key: string, i: string, value: any): Promise<boolean>

    /** Increment an integer item in a map, returning the new value. */
    mapItemIncr(key: string, i: string): Promise<number>

    /** Return a string map associated with a key. */
    strMap<T extends object>(key: string): Promise<T>

    /** Modify the string map associated with a key. */
    strMapMod<T extends object>(key: string, changes: T): Promise<void>

    /** Return an item in a string map. */
    strMapItem(key: string, i: string): Promise<string>

    /** Modify an item in a string map. */
    strMapItemMod(key: string, i: string, str: string): Promise<boolean>

    /**
     * Return a lightweight message broker, if one is available as
     * part of the store implementation.
     */
    broker(): MessageBroker

    /** Close the key-value store, releasing any related resources. */
    close(): void
}

/**
 * Lightweight publish/subscribe interface.
 */
export interface MessageBroker {
    /** Add a subscriber. */
    subscriberAdd(subscriber: Subscriber, ...topics: string[]): Promise<void>

    /** Remove a subscriber. */
    subscriberDel(subscriber: Subscriber, ...topics: string[]): Promise<void>

    /** Publish a message to subscribers. */
    publish(topic: string, message: string): Promise<void>
}

/**
 * A subscriber implements this interface.
 */
export interface Subscriber {
    messageReceived?(topic: string, message: string)
}


/**
 * Return a store for a Redis server. The configuration must contain
 * a host property specify the server.
 */
export function redisStore(config?): KeyValueStore {
    return RedisStore.initial(config)
}


export class Subscription {
    client: any
    topics: Set<string>
}

export type Result = (err, res) => void

export class RedisStore implements KeyValueStore, MessageBroker {

    impl: any
    config: any
    private subscriptions: Map<Subscriber,Subscription>


    static initial(config?): RedisStore {
        const cfg = Object.assign({host: '127.0.0.1'}, config)
        const impl = redis.createClient(cfg)
        logger.info('Redis server is ' + cfg.host)

        const store = new RedisStore()
        store.impl = impl
        store.config = JSON.parse(JSON.stringify(cfg))
        return store
    }


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

    strValueMod(key: string, str: string): Promise<void> {
        return new Promise<void>((resolve, reject) =>
            this.impl.set(key, str, voidResult(resolve, reject))
        )
    }

    valueIncr(key: string): Promise<number> {
        return new Promise<number>((resolve, reject) =>
            this.impl.incr(key, parseResult(resolve, reject))
        )
    }

    valueDel(...keys: string[]): Promise<number> {
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

    mapDel(key: string, ...i: string[]): Promise<number> {
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

    strMapItemMod(key: string, i: string, str: string): Promise<boolean> {
        return new Promise<boolean>((resolve, reject) =>
            this.impl.hset(key, i, str, (err, res) => 
                err ? reject(err) : resolve(res == 1)
            )
        )
    }


    broker(): MessageBroker {
        return this
    }

    subscriberAdd(subscriber: Subscriber, ...topics: string[]): Promise<void> {
        let s
        if (!this.subscriptions) {
            this.subscriptions = new Map<Subscriber,Subscription>()
            s = this.addSubscription(subscriber, topics)
        } else {
            s = this.subscriptions.get(subscriber)
            if (!s) {
                s = this.addSubscription(subscriber, topics)
            } else {
                for (let t of topics) {
                    s.topics.add(t)
                }
            }
        }

        const client = s.client
        return new Promise<void>((resolve, reject) => {
            client.on('subscribe', (topic, count) => resolve())
            client.subscribe(...topics)
        })
    }

    private addSubscription(sub: Subscriber, topics: string[]): Subscription {
        const s = new Subscription()
        s.client = redis.createClient(this.config)
        s.topics = new Set<string>()
        for (let t of topics) {
            s.topics.add(t)
        }
        this.subscriptions.set(sub, s)

        s.client.on('message', (topic, message) => {
            if (sub.messageReceived && s.topics.has(topic)) {
                sub.messageReceived(topic, message)
            }
        })

        return s
    }

    subscriberDel(subscriber: Subscriber, ...topics: string[]): Promise<void> {
        const s = this.subscriptions.get(subscriber)
        if (!s) {
            return new Promise<void>((resolve, reject) => resolve())
        }

        if (topics.length === 0) {
            s.topics.clear()
        } else {
            for (let t of topics) {
                s.topics.delete(t)
            }
        }

        const client = s.client
        if (s.topics.size !== 0) {
            return new Promise<void>((resolve, reject) =>
                client.unsubscribe(...topics, voidResult(resolve, reject))
            )
        }

        this.subscriptions.delete(subscriber)
        return new Promise<void>((resolve, reject) => {
            client.unsubscribe((err, res) => {
                client.quit()
                if (err) {
                    logger.warn(err)
                }
                resolve()
            })
        })
    }

    publish(topic: string, message: string): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            this.impl.publish(topic, message, voidResult(resolve, reject))
        })
    }


    close(): void {
        this.impl.quit()
    }

}

/**
 * Helper callback for returning a raw result.
 */
function result(resolve, reject): Result {
    return (err, res) => err ? reject(err) : resolve(res)
}

/**
 * Helper callback that converts a string result to an object.
 */
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

/**
 * Helper callback for a callback without a return value.
 */
function voidResult(resolve, reject): Result {
    return (err, res) => err ? reject(err) : resolve()
}
