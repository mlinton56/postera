## slogger

The slogger module defines a simple interface that is common to many
logging libraries, winston in particular, and simplifies
sharing a logger instance across multiple modules. The intent
is to allow modules to share a logger object without knowing anything
about its underlying implementation.

Using slogger, one module defines the logger implementation:

    import * as slogger from 'postera/slogger'

    slogger.defaultLogger.impl = new winston.Logger(...)

Other modules simply import and use the exported logger object:

    import logger from 'postera/slogger'

    logger.info('This is an info log')

In this example, calling <code>logger.info</code> will call
the <code>info</code> method on the Winston logger object.
The slogger implementation uses a proxy object
to implement this forwarding mechanism, which means there is no ordering
requirement--it is not necessary to assign <code>defaultLogger.impl</code>
before other modules import the logger object
(of course the assignment must occur before the other modules
execute code using the logger object).

The interface defines log, error, warn, info, debug, and verbose methods.
For convenience, a caller also may pass an Error object
for the message parameter. By default the proxy uses the Error stack property
as the message but may be overridden to use the Error message property:

    logger.errStackFlag = false

If no implementation is assigned to defaultLogger then slogger uses
a simple builtin implementation that writes to the console. There is also
an option to create a logger that writes to a file
using the <code>fileLogger</code> function.
