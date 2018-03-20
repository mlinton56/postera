/*
 * Copyright (c) 2001-2018 Mark A. Linton
 *
 * Use of this source code is governed by the MIT-style license that is
 * in the LICENSE file or at https://opensource.org/licenses/MIT.
 */

import * as devices from './devices'
import * as dynlib from './dynlib'
import logger from './slogger'


const EnumValue = 'int32'

const CFStringRef = 'pointer'
const CFMachPortRef = 'pointer'
const CFAllocatorRef = dynlib.voidPtr
const CFIndex = 'int64'
const CFRunLoop = 'pointer'
const CFRunLoopMode = CFStringRef
const CFRunLoopSource = 'pointer'

const cf = dynlib.library('CoreFoundation.framework/CoreFoundation', {
    runLoop: ['CFRunLoopGetCurrent', [], CFRunLoop],
    runLoopNewSource: ['CFMachPortCreateRunLoopSource',
        [CFAllocatorRef, CFMachPortRef, CFIndex], CFRunLoopSource
    ],
    runLoopAddSource: ['CFRunLoopAddSource',
        [CFRunLoop, CFRunLoopSource, CFRunLoopMode], 'void'
    ],
    runLoopStart: ['CFRunLoopRun', [], 'void'],
    runLoopStop: ['CFRunLoopStop', [CFRunLoop], 'void'],
    commonModes: ['kCFRunLoopCommonModes', CFRunLoopMode],
    allocatorDefault: ['kCFAllocatorDefault', CFAllocatorRef]
})


const CGFloat = 'double'

const CGPoint = dynlib.struct({
    x: CGFloat,
    y: CGFloat
})
const CGSize = dynlib.struct({
    width: CGFloat,
    height: CGFloat
})
const CGRect = dynlib.struct({
    origin: CGPoint,
    size: CGSize
})

enum EventTapLocation {
    hid = 0, session, annotatedSession
}

enum EventTapPlacement {
    headInsert, tailAppend
}

const EventTapProxy = 'pointer'

enum EventType {
    leftMouseDown = 1, leftMouseUp, rightMouseDown, rightMouseUp, mouseMoved,
    leftMouseDragged, rightMouseDragged, keyDown, keyUp, flagsChanged,
    scrollWheel, tabletPointer, tabletProximity,
    otherMouseDown, otherMouseUp, otherMouseDragged,
    tapDisabledByTimeout, tapDisabledByUserInput,
    end
}

const EventFlags = 'uint64'
const EventTimestamp = 'uint64'
const EventRef = dynlib.voidPtr
const EventMask = 'uint64'

const cg = dynlib.library('CoreGraphics.framework/CoreGraphics', {
    mainDisplayId: ['CGMainDisplayID', [], 'uint32'],
    displayBounds: ['CGDisplayBounds', ['uint32'], CGRect],
    screenSize: ['CGDisplayScreenSize', ['uint32'], CGSize],
    eventTapNew: ['CGEventTapCreate',
        [EnumValue, EnumValue, 'int32', EventMask, 'pointer', 'pointer'],
        CFMachPortRef 
    ],
    eventTapEnable: ['CGEventTapEnable', [CFMachPortRef, 'bool'], 'void'],
    eventFlags: ['CGEventGetFlags', [EventRef], EventFlags],
    eventTimestamp: ['CGEventGetTimestamp', [EventRef], EventTimestamp],
    eventLocation: ['CGEventGetLocation', [EventRef], CGPoint],
    eventUnflippedLocation: ['CGEventGetUnflippedLocation', [EventRef], CGPoint],
})

export default class MacDevice extends devices.UserDevice {

    private mainDisplayId: number
    private tap: any
    private source: any

    constructor() {
        super()
        const displayId = cg.mainDisplayId()
        const mm = cg.screenSize(displayId)
        const pixels = cg.displayBounds(displayId)
        this.mainDisplayId = displayId
        this.defaultScreenMod({
            width: mm.width * devices.mm,
            height: mm.height * devices.mm,
            ppi: pixels.size.width / (mm.width / devices.mmInch)
        })
    }


    loopStart(): void {
        if (!this.source) {
            const mask = (1 << (EventType.end - 1)) - 1
            this.tap = cg.eventTapNew(
                EventTapLocation.session, EventTapPlacement.headInsert, 0, mask,
                dynlib.callback(
                    [EventTapProxy, EnumValue, EventRef, 'pointer'], EventRef,
                    (proxy, type, event, data) => {
                        this.postEvent(type, event)
                        return event
                    }
                ), null
            )

            this.source = cf.runLoopNewSource(
                cf.allocatorDefault.deref(), this.tap, 0
            )
        }

        cf.runLoopAddSource(cf.runLoop(), this.source, cf.commonModes.deref())
        cg.eventTapEnable(this.tap, true)
        cf.runLoopStart()
    }

    loopStop(): void {
        cg.eventTabEnable(this.tap, false)
        cf.runLoopStop(cf.runLoop())
    }

    private postEvent(type: EventType, eventRef): void {
        if (type === EventType.mouseMoved) {
            const ts = cg.eventTimestamp(eventRef)
            const p = cg.eventUnflippedLocation(eventRef)
            this.post('mouseMoved', {timestamp: ts, x: p.x, y: p.y})
        }
    }

}
