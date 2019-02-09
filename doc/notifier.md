## notifier

The notifier module provides a base class to implement notifications.
The approach is similar to Node.js' EventEmitter with two important differences:
(1) notifications have method-like signatures (always void return types), and
(2) one adds a listener to a notifier before an event might occur
to avoid missing any events. Node.js assumes that a caller is synchronous
with an event emitter, so it is ok to add a listener after potentially
generating an event. We do not make that assumption here, which is particularly
significant when using await expressions.

Notifier is a generic class parameterized by a listener type that defines
the notifications posted by a notifier descendant. Normally, the listener type
is an interface containing optional methods.

    import Notifier from 'postera/notifier'

    export interface MyListener {
        xModified?(n: MyClass, x: number): void
        yModified?(n: MyClass, y: number): void
    }

    export class MyClass extends Notifier<MyListener> {
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
    }

    const myObject = new MyClass()
    myObject.listenerAdd(new class implements MyListener {
        xModified(n: MyClass, x: number): void {
            console.log('x modified to ' + x)
        }
    }())
    myObject.x = 3
    myObject.x = 4

An implementation of Notifier.post may deliver the notifications
to listeners immediately; however, one should not assume this behavior.
In particular, an implementation may run the listeners independent
of the caller context using something such as setTimeout or process.nextTick.
The general idea is that notifiers and listeners are logically decoupled and
it is an error to assume that listeners will complete before the call
to Notifier.post returns. On the listener side, that means
in the example above it is possible that the new value in the notification (x)
is not the same as the current value (n.x).

Notifier defines the protected methods listeningStarted and listeningStopped
that listenerAdd and listenerDel call when the number of listeners changes
from zero to one or one to zero, respectively. The listenerDelAll method
always calls listeningStopped. The default implementations of these methods
do nothing. They can be useful for notifiers that alter their behavior
depending on whether they have any listeners or not.
