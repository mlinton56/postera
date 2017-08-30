/**
 * Simple notifier tests.
 */
import Notifier from 'postera/notifier'

require('source-map-support').install()

interface TestListener {
    xModified?(n: TestNotifier, x: number): void
    yModified?(n: TestNotifier, y: number): void
}

class TestNotifier extends Notifier<TestListener> {

    private xVar: number
    get x() { return this.xVar }
    set x(x0) {
        this.xVar = x0
        this.post('xModified', this, x0)
    }

    private yVar: number
    get y() { return this.yVar }
    set y(y0) {
        this.yVar = y0
        this.post('yModified', this, y0)
    }

    protected listeningStarted() {
        console.log('listeningStarted')
    }

    protected listeningStopped() {
        console.log('listeningStopped')
    }

}

const n = new TestNotifier()
n.x = 3

n.listenerAdd(new class implements TestListener {

    xModified(n: TestNotifier, x: number) {
        console.log('xModified ' + x)
    }

}())

n.x = 4
n.x = 5

n.listenerDelAll()

n.listenerAdd(new class implements TestListener {

    yModified(n: TestNotifier, y: number) {
        console.log('yModified ' + y)
    }

}())

n.y = 3
n.y = 4

const a = []
for (const listener of n.listeners) {
    a.push(listener)
}

n.listenerDel(a[0])
