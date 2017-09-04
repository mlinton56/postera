## reqm

The reqm module provides an interface to make HTTP requests in either
Node.js or browser environment that return a promise
of a RequestInfo instance. This approach allows one to use await
to block until the request completes. Requests specify options
with a URL string or an object that conforms to the RequestOptions interface.

    import defaultManager from 'postera/reqm'
    const reqm = defaultManager()

    let r = await reqm.get('http://duckduckgo.com')
    console.log(r.result)

    r = await reqm.post({url: 'https://duckduckgo.com/?q=foo&t=hw&ia=web'})

The default object in the reqm module is a RequestManager instance
specific to the execution environment (Node.js or web browser). This object
contains a default set of request options that the request argument overrides.

    reqm.defaultOptions.protocol = 'https'
    reqm.defaultOptions.hostname = 'myhost.com'
    reqm.defaultOptions.headers = {'authorization': accessToken}
    r = await reqm.get({pathname: '/a'})
    r = await reqm.get({pathname: '/b'})

The return value from a request is an instance of RequestInfo, which provides
access to the request options (using the properties protocol, method, headers,
et al.) and the response (using the responseHeader method and
the responseType, statusCode, statusText, responseXml, responseBody, and result
getters). If the responseType is JSON then the result is JSON.parse called
on the responseBody (or the error thrown by JSON.parse, if there is one).

The put, post, and patch methods take an additional body and
optional type parameter. The body is optional for the del(ete) method.
If no type is given RequestManager assumes the type is JSON, and if the type
is JSON (either explicitly or implicitly) then JSON.stringify(body) will be
sent in the request. If the given body is a function then the manager
will call the function passing an object that has a write method with
a string parameter. The string result from calling body(writer) is then
sent as request body.

A request that fails will reject the returned promise, which throws an exception
in the await case. A request manager has two special function properties,
redirector and authorizer, to process error cases involving a 3xx or 401 status,
respectively. Each function is given the RequestInfo instance and
the resolve and reject functions to fulfill or reject the promise.

Request managers are also notifiers for the RequestListener interface,
generating notifications when a request succeeds, is redirected, fails
with a 4xx or 5xx status, gets an error while sending the request, or
gets an error while receiving the response.
