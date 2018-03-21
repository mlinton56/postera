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
const CFAllocatorRef = dynlib.ptr('void')
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


const CGDirectDisplayId = 'uint32'
const CGDirectDisplayIdArray = dynlib.array(CGDirectDisplayId)

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
const EventRef = dynlib.ptr('void')
const EventMask = 'uint64'

const cg = dynlib.library('CoreGraphics.framework/CoreGraphics', {
    mainDisplay: ['CGMainDisplayID', [], CGDirectDisplayId],
    activeDisplays: ['CGGetActiveDisplayList',
        ['uint32', CGDirectDisplayIdArray, dynlib.ptr('uint32')],
        'int32'
    ],
    displayBounds: ['CGDisplayBounds', [CGDirectDisplayId], CGRect],
    screenSize: ['CGDisplayScreenSize', [CGDirectDisplayId], CGSize],
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

/**
 * Implementation of a UserDevice on macOS.
 *
 * TODO: Need to support multiple monitors with different resolutions.
 */
export default class MacDevice extends devices.UserDevice {

    private displays: number[]
    private mainDisplay: number
    private screenList: devices.Screen[]
    private multiFlag: boolean
    private tap: any
    private source: any


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

    protected init(): void {
        super.init()
        this.screenList = []
        const main = cg.mainDisplay()
        const displays = new CGDirectDisplayIdArray(10)
        const out = dynlib.alloc('uint32')
        cg.activeDisplays(displays.length, displays, out)
        const n = out.deref()
        for (let i = 0; i < n; ++i) {
            const d = displays[i]
            const mm = cg.screenSize(d)
            const pixels = cg.displayBounds(d)
            const left = pixels.origin.x
            const bottom = pixels.origin.y
            const width = mm.width * devices.mm
            const height = mm.height * devices.mm
            const right = left + width
            const top = bottom + height
            const ppi = pixels.size.width * devices.mmInch / mm.width
            const coord = devices.coordInch / ppi
            const screen: devices.Screen = {
                left, bottom, right, top, width, height, ppi, coord
            }
            this.screens.set(d.toString(), screen)
            this.screenList.push(screen)
            if (d === cg.mainDisplay()) {
                this.mainDisplay = d
                this.defaultScreenVar = screen
            }
        }
        this.multiFlag = this.screenList.length > 1
    }

    private postEvent(type: EventType, eventRef): void {
        if (type === EventType.mouseMoved) {
            const timestamp = cg.eventTimestamp(eventRef)
            const p = cg.eventUnflippedLocation(eventRef)
            const screen = this.multiFlag ? this.screenFor(p) : this.defaultScreen
            const x = p.x * screen.coord
            const y = p.y * screen.coord
            this.post('mouseMoved', {timestamp, x, y})
        }
    }

    private screenFor(p): devices.Screen {
        for (const s of this.screenList) {
            if (p.x >= s.left && p.x < s.left + s.width &&
                p.y >= s.bottom && p.y < s.bottom + s.height
            ) {
                return s
            }
        }

        return this.defaultScreen
    }

}
