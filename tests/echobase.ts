import { UserDevice, UserDeviceListener, MouseInput } from 'postera/devices'

require('source-map-support').install()
process.on('unhandledRejection', function(err, p) { console.log(err.stack) })

const device = UserDevice.instance()
console.log(device.defaultScreen)

device.listenerAdd({

    mouseMoved(input: MouseInput): void {
        console.log('(' + input.x + ',' + input.y + ')')
    }

})

device.loopStart()
