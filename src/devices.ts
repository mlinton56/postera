/*
 * Copyright (c) 2001-2018 Mark A. Linton
 *
 * Use of this source code is governed by the MIT-style license that is
 * in the LICENSE file or at https://opensource.org/licenses/MIT.
 */

import Notifier from './notifier'

/**
 * Float and Integer are number synonyms for explanatory purposes.
 */
export type Float = number
export type Integer = number

/**
 * Coord types are floating point numbers and resolution-independent:
 * one coordinate is 1/96th of an inch.
 *
 * Pixel types are integers and resolution-dependent.
 *
 * Unfortunately there is no current way to specify value types in TypeScript.
 */
export type Coord = Float
export type XCoord = Coord
export type YCoord = Coord

export const coordInch = 96.0
export const pointsInch = 72.0
export const cmInch = 2.54
export const mmInch = 25.4

export const inch = coordInch
export const pt = coordInch / pointsInch
export const cm = coordInch / cmInch
export const mm = coordInch/ mmInch


export type PixelCoord = Integer
export type XPixel = PixelCoord
export type YPixel = PixelCoord

export const zero = 0.0
export const zeroX: XCoord = 0.0
export const zeroY: YCoord = 0.0

const tolerance = 1e-2

/**
 * Test if two floats are equal within the predefined tolerance.
 */
export function equalF(f1: Float, f2: Float): boolean {
    return f1 < f2 + tolerance && f1 > f2 - tolerance
}

/**
 * Test if two floats are not equal within the predefined tolerance.
 */
export function notEqualF(f1: Float, f2: Float): boolean {
    return f1 > f2 + tolerance || f1 < f2 - tolerance
}

/**
 * Tests for comparing floating-point coordinates.
 */

export function equalX(x1: XCoord, x2: XCoord) { return equalF(x1, x2) }
export function notEqualX(x1: XCoord, x2: XCoord) { notEqualF(x1, x2) }
export function equalY(y1: YCoord, y2: YCoord) { return equalF(y1, y2) }
export function notEqualY(y1: YCoord, y2: YCoord) { return notEqualF(y1, y2) }

const devices = new Map<string,UserDevice>()

/**
 * The UserDevice class defines the system features of a user device such as
 * desktop, laptop, tablet, or phone.
 */
export abstract class UserDevice extends Notifier<UserDeviceListener> {

    static instance(name?: string): UserDevice {
        const impl = name || UserDevice.defaultImpl()
        let d = devices.get(impl)
        if (!d) {
            const cl = require('./' + impl + '-devices.js')['default']
            d = new cl()
            devices.set(impl, d)
        }

        return d
    }

    private static defaultImpl(): string {
        if (typeof window !== 'undefined') {
            return 'web'
        }

        return process.env.USERDEVICE || require('os').platform
    }


    screens: Map<string,Screen>

    private defaultScreenVar: Screen
    get defaultScreen(): Screen {
        return this.defaultScreenVar
    }

    protected defaultScreenMod(s: Screen): void {
        this.defaultScreenVar = s
        if (!this.screens) {
            this.screens = new Map<string,Screen>()
            this.screens.set('default', this.defaultScreenVar)
        }
    }

    /**
     * Start a loop to dispatch events for this device and wait
     * for the loop to stop.
     */
    abstract loopStart(): void

    /**
     * Stop the loop dispatching events for this device.
     */
    abstract loopStop(): void

}

export class Screen {
    width: XCoord
    height: YCoord
    ppi: Float
}


export interface UserDeviceListener {
    mouseMoved?(input: MouseInput): void
    mousePressed?(input: MouseInput): void
    mouseReleased?(input: MouseInput): void
    mouseCanceled?(input: MouseInput): void
    wheelRolled?(input: MouseInput): void
    wheelTilted?(input: MouseInput): void

    touchStarted?(input: TouchInput): void
    touchMoved?(input: TouchInput): void
    touchFinished?(input: TouchInput): void
    touchCanceled?(input: TouchInput): void

    keyPressed?(input: KeyInput): void
    keyReleased?(input: KeyInput): void
    keyCanceled?(input: KeyInput): void
}

export class DeviceInput {
    readonly timestamp: Integer
    readonly modifiers: KeyModifierSet
}

export class MouseInput extends DeviceInput {
    readonly x: XCoord
    readonly y: YCoord
}

export class Touch {
    readonly identifier: number
    readonly x: XCoord
    readonly y: YCoord
}

export class TouchInput extends DeviceInput {
    readonly touches: Touch[]
    readonly changed: Touch[]
}

export class KeyInput extends DeviceInput {
    readonly key: string
    readonly code: string
    readonly location: KeyLocation
}

export enum KeyLocation { std, left, right, numpad }
export enum KeyModifier { shift, capslock, control, fn, meta, alt }

export type KeyModifierSet = Integer
