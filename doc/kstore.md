## kstore

The kstore module provides common methods to access a shared key-value store,
with an implementation for Redis. The methods are promise-based
to simplify coding synchronous use cases.

The method interfaces support associating strings or objects with a string key,
as well as maps of strings or objects accessed by an item identifier (string).

    import * as kstore from 'postera/kstore'

    // Access a key-value store with a given configuration.
    const store = kstore.redisStore({host: 'localhost'})

    // Modify the value associated with a key.
    await store.valueMod('object', {a: 3, b: 4})

    // Access the associated value, which is {a: 3, b: 4}.
    const obj = await store.value('object')

    // Delete an association
    await store.valueDel('object')

Note that values are normally converted to and from strings with
JSON.stringify and JSON.parse. To avoid conversion use string values:

    await store.strValueMod('object', 'this is a string')

#### Maps

A map is like another value (it can be deleted with valueDel, for example)
but allows access by item without retrieving the full map.

    // Associate a map.
    await store.mapMod('map', {a: 3, b: 4})

    //
    // Access an item without getting the entire map. In this case
    // the return value is 3.
    //
    await store.mapItem('map', 'a')

    // Modify an item within a map.
    if (await store.mapItemMod('map', 'c', 5)) {
        // Returns true if the item is new to the map.
    }

    // Access the entire map at once--this returns {a: 3, b: 4}.
    await store.map('map')

As with values, map items are normally converted to and from strings
with JSON.stringify and JSON.parse. To avoid conversion use string maps:

    await store.strMapMod('map', {'a': 'a string', b: 'b string'})
    await store.strMapItem('map', 'a')
    await store.strMapItemMod('map', 'c', 'c string')
    await store.strMap('map')
