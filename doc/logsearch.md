## logsearch

The logsearch module provides a simple interface to search log files,
including an implementation using the
[Papertrail HTTP API](https://help.papertrailapp.com/kb/how-it-works/http-api)
Note that although there is a common interface to construct a search,
the structure of a search result depend on the underlying log implementation.
Seems like it would make sense in the future to provide a common interface
to extract the timestamp, optional level, and text message of a log entry.

    import * as logsearch from 'postera/logsearch'

    const now = Math.round(Date.now() / 1000)
    const m = logsearch.manage('papertrail', {start: now - 60 * 60, stop: now})
    await m.search(handleEvent)

    function handleEvent(event) {
        console.log(event.received_at + ': ' + event.message)
    }
