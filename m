#!/usr/bin/env node

// Bootstrap mk.ts.
var fs = require('fs');
var path = require('path');
var child = require('child_process')

var top = process.env.POST
var build = top + '/build/mk';
var src = top + '/src';

function cmd(s) {
    console.log(s);
    child.execSync(s, {shell: 'bash', stdio: [0, 1, 2]});
}

if (!fs.existsSync(build)) {
    cmd('mkdir -p ' + build + ' && ' +
        'cd ' + build + ' && ' +
        'npm install --no-package-lock --silent ' +
            '@types/node source-map source-map-support'
    );
}


function modified(target, deps) {
    var mtime = fs.statSync(target).mtime.valueOf()
    for (var i = 0; i < deps.length; ++i) {
        if (fs.statSync(deps[i]).mtime.valueOf() > mtime) {
            return true;
        }
    }

    return false;
}


var mk = build + '/mk.js';
var mksrc = top + '/mk.ts';
if (!fs.existsSync(mk) || modified(mk, [mksrc, src + '/tshell.ts'])) {
    cmd('cd ' + build + ' && ' +
        'tsc --alwaysStrict true --removeComments true' +
            ' --baseUrl ' + src + ' --module commonjs --target es6' +
            ' --typeRoots node_modules/@types --types node' +
            ' --outdir . ' + mksrc
    );
}

require(mk).main(top, process.argv.slice(2));
