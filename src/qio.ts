/**
 * Use queues to send and receive messages.
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

import logger from './slogger'

const amqp = require('amqplib/callback_api')

/**
 * There is no abstract queue object, only concrete information about a queue.
 */
export class QueueInfo {
    name?: string
    url?: string
    options?: any
}

/**
 * Convenience function to convert data to a message buffer.
 */
export function message(m: any): Buffer {
    return Buffer.from(typeof m === 'string' ? <string>m : JSON.stringify(m))
}

export type Ack = () => void
export type Receiver = (buf: Buffer, ack?: Ack) => void
export type Callback = (err?: Error) => void

function nop(err?: Error) { }


/**
 * Options when connecting a channel.
 */
export interface ConnectionOptions {
    retryDelay: number
    retryCount: number
}

/**
 * Options when sending a message to a queue.
 */
export interface SendOptions {
    priority?: number
}

/**
 * Options when receiving messages from a queue.
 */
export interface ReceiveOptions {
    prefetch?: number
    consumerTag?: string
    priority?: number
}


/**
 * Base class for posting notifications to listeners.
 */
export class Notifier<T> {

    protected listeners: T[] = []

    /**
     * Add a listener and return it.
     */
    listenerAdd(listener: T): T {
        this.listeners.push(listener)

        if (this.listeners.length === 1) {
            this.listeningStarted()
        }

        return listener
    }

    /**
     * Remove a listener, returning the removed listener or null
     * if there was none.
     */
    listenerDel(listener: T): T {
        const listeners = this.listeners
        for (let i = 0; i < listeners.length; ++i) {
            if (listeners[i] === listener) {
                listeners.splice(i, 1)

                if (listeners.length === 0) {
                    this.listeningStopped()
                }

                return listener
            }
        }

        return null
    }

    /**
     * Remove all the listeners.
     */
    listenerDelAll(): void {
        if (this.listeners.length > 0) {
            this.listeners = []
            this.listeningStopped()
        }
    }

    /**
     * Post a notification to all listeners. Notification should specify
     * a method on T, and args should match the method parameters.
     * If the listener does not implement the method then ignore
     * the notification.
     */
    protected post(notification: string, ...args: any[]): void {
        for (let listener of this.listeners) {
            const r = listener[notification]
            if (r) {
                r.apply(listener, args)
            }
        }
    }

    protected listeningStarted(): void {
        // Default is to do nothing.
    }

    protected listeningStopped(): void {
        // Default is to do nothing.
    }

}

export interface ChannelListener {
    opened?(channel: Channel): void
    closed?(channel: Channel): void
    error?(channel: Channel): void
}


let channelMap = {}

/**
 * Channel provides methods for sending and receiving messages
 * through a queue.
 */
export class Channel
    extends Notifier<ChannelListener> implements ConnectionListener
{

    options: ConnectionOptions

    private connectionVar: Connection
    get connection() { return this.connectionVar }
    get url() { return this.connectionVar.url }

    private ch: any

    /**
     * Return a channel for a given url, re-using an existing one
     * if there already is one.
     */
    static instance(url: string, options?: ConnectionOptions): Channel {
        let ch = channelMap[url]

        if (!ch || JSON.stringify(options) !== JSON.stringify(ch.options)) {
            ch = Channel.initial(Connection.instance(url, options), options)
            channelMap[url] = ch
        }

        return ch
    }

    /**
     * Return a new channel for a given connection.
     */
    static initial(connection: Connection, options?: ConnectionOptions): Channel {
        let channel = new Channel()
        channel.options = options
        channel.connectionVar = connection
        channel.ch = null
        channel.listeners = []
        connection.channelAdd(channel)
        return channel
    }


    /**
     * Add a queue if not already defined.
     */
    queueAddIf(q: QueueInfo): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            this.open((ch) => {
                ch.assertQueue(q.name, q.options, (err, ok) => {
                    if (err) {
                        reject(err)
                    } else {
                        resolve()
                    }
                })
            })
        })
    }

    /**
     * Add a message to a queue.
     */
    messageAdd(q: QueueInfo, m: Buffer, s?: SendOptions, f?: Callback): void {
        const cb = f || nop
        this.open((ch) => {
            try {
                ch.sendToQueue(q.name, m, s)
                cb()
            } catch (e) {
                cb(e instanceof Error ? <Error>e : new Error(e.toString()))
            }
        })
    }

    /**
     * Add a receiver for the given queue.
     */
    receiverAdd(q: QueueInfo, r: Receiver, options?: ReceiveOptions): void {
        const name = q.name
        const opts = Object.assign({}, options, {noAck: false})
        this.listen((ch) => {
            ch.prefetch(opts.prefetch || 1)
            ch.consume(name, (msg) => r(msg.content, () => ch.ack(msg)), opts)
        })
    }

    /**
     * Add a consumer for the given queue.
     */
    consumerAdd(q: QueueInfo, r: Receiver, options?: ReceiveOptions): void {
        const name = q.name
        const opts = Object.assign({}, options, {noAck: true})
        this.listen((ch) => {
            ch.consume(name, (msg) => r(msg.content), opts)
        })
    }

    /**
     * Force closure of a channel.
     */
    close(): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            const c = this.connection
            const ch = this.ch
            if (ch) {
                this.ch = null
                ch.close((err) => {
                    if (err) {
                        reject(err)
                    } else {
                        resolve()
                    }
                    c.channelDel(this)
                })
            } else {
                resolve()
                c.channelDel(this)
            }
        })
    }


    protected listeningStarted(): void {
        this.connectionVar.listenerAdd(this)
    }

    protected listeningStopped(): void {
        this.connectionVar.listenerDel(this)
    }


    private open(f: (ch) => void): ChannelListener {
        if (this.ch) {
            f(this.ch)
            return null
        }

        return this.listenerAdd(new class implements ChannelListener {
            opened(channel: Channel): void {
                f(channel.ch)
                channel.listenerDel(this)
            }
        })
    }

    private listen(f: (ch) => void): void {
        if (this.ch) {
            f(this.ch)
        }
        this.listenerAdd(new class implements ChannelListener {
            opened(channel: Channel): void {
                f(channel.ch)
            }
        })
    }

    connected(connection: Connection): void {
        const conn = connection.conn
        conn.createChannel((err, ch) => {
            if (err) {
                //
                // Only reasonable failure here is too many open channels,
                // which we can't really do anything about here.
                logger.error(err)
                this.post('error', this, err)
                return
            }

            logger.debug('created amqp channel for ' + connection.url)
            this.ch = ch
            this.post('opened', this)

            ch.on('error', (err) => {
                logger.error(err)
                this.post('error', this, err)
                this.ch = null
            })

            ch.on('close', () => {
                logger.debug('closed channel for ' + this.url)
                this.post('closed', this)
                this.ch = null
            })
        })
    }

    disconnected(connection: Connection): void {
        logger.debug('disconnected channel for ' + connection.url)
        this.ch = null
    }

}


/**
 * Listener interface for notifications from a connection.
 */
export interface ConnectionListener {
    connected?(c: Connection): void
    disconnected?(c: Connection): void
}

let connectionMap = {}

/**
 * A connection identifies an AMQP server and may have an active connection
 * to the service.
 */
export class Connection extends Notifier<ConnectionListener> {

    private urlVar: string
    get url() { return this.urlVar }

    options: ConnectionOptions

    private channels: Channel[]

    conn: any


    /**
     * Return a connection instance for the given AMQP server URL,
     * using an existing instance if there is one.
     */
    static instance(url: string, options?: ConnectionOptions): Connection {
        let c = connectionMap[url]

        if (!c) {
            c = Connection.initial(url, options)
            connectionMap[url] = c
        }

        return c
    }

    /**
     * Return a new connection instance using the given AMQP server URL.
     */
    static initial(url: string, options?: ConnectionOptions): Connection {
        const c = new Connection()
        c.urlVar = url
        c.options = Object.assign({retryDelay: 15, retryCount: 10}, options)
        c.channels = []
        c.conn = null
        return c
    }


    channelAdd(channel: Channel): Channel {
        this.channels.push(channel)
        return channel
    }

    channelDel(channel: Channel): Channel {
        const channels = this.channels
        for (let i = 0; i < channels.length; ++i) {
            if (channels[i] === channel) {
                channels.splice(i, 1)
                if (channels.length === 0) {
                    this.close()
                }

                return channel
            }
        }

        return null
    }

    channelDelAll(): void {
        if (this.channels.length > 0) {
            this.channels = []
            this.close()
        }
    }

    close(): void {
        const conn = this.conn
        if (conn) {
            conn.close((err) => {
                if (err) {
                    logger.error(err)
                }
                this.conn = null
            })
        }
    }

    protected listeningStarted(): void {
        if (this.conn) {
            return;
        }

        this.connect(0)
    }

    private connect(count: number): void {
        const url = this.urlVar
        const options = this.options
        logger.debug('trying to connect (' + count + ')')
        amqp.connect(url, (err, conn) => {
            if (err) {
                logger.error(err)

                if (count < options.retryCount) {
                    logger.info('waiting ' + options.retryDelay + ' to retry')
                    setTimeout(() => this.connect(count + 1), options.retryDelay)
                }

                return
            }

            logger.debug('connected to ' + url)

            this.conn = conn
            this.post('connected', this)

            conn.on('error', (err) => {
                if (err.message === 'Unexpected close') {
                    logger.info('Ignoring unexpected close error')
                } else {
                    logger.error(err)
                    this.post('error', this, err)
                }
                this.conn = null
            })

            conn.on('close', () => {
                logger.debug('closing connection to ' + url)
                this.post('disconnected', this)
                this.conn = null

                if (this.listeners.length > 0) {
                    this.listeningStarted()
                }
            })
        })

    }

}
