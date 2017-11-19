/**
 * Runtime for jload consists of two functions that manage a module map:
 *
 *     _jload_moduleAdd adds a module to the map
 *     _jload_moduleVal returns a valid module from the map or throws an exception
 *     _jload_moduleRef returns the (possibly undefined) map entry
 */

(function(scope) {

    // Only define these methods once.
    if (scope._jload) {
        return;
    }


    var modules = new Map();
    var currentDir = './';

    scope._jload = true;

    scope._jload_moduleAdd = function(name, m) {
        var prev = currentDir;

        var i = name.lastIndexOf('/');
        if (i >= 0) {
            currentDir = name.substring(0, i + 1);
        }

        modules.set(name, m);
        modules.set(name + '.js', m);

        currentDir = prev;
    }

    scope._jload_moduleRef = function(dir, name) {
        return modules.get(normalize(dir + name));
    }

    if (!scope._jload_moduleVal) {
        scope._jload_moduleVal = function(dir, name) {
            var fq = normalize(dir + name);
            var m = modules.get(fq);
            if (!m) {
                throw new Error('Cannot find ' + fq);
            }
            return m;
        }
    }

    if (!scope.require) {
        scope.require = function(name) {
            return _jload_moduleVal('./', name);
        }
    }

    function normalize(path) {
        var list = path.split('/');

        var newList = [ ];
        var level = 0;
        for (var i = 0; i < list.length; ++i) {
            var component = list[i];
            if (component !== ".") {
                if (component === ".." && level > 0) {
                    level -= 1;
                    newList.pop();
                } else {
                    level += 1;
                    newList.push(component);
                }
            }
        }

        return newList.join('/');
    }

})(this);
