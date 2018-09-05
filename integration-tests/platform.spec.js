/**
    Licensed to the Apache Software Foundation (ASF) under one
    or more contributor license agreements.  See the NOTICE file
    distributed with this work for additional information
    regarding copyright ownership.  The ASF licenses this file
    to you under the Apache License, Version 2.0 (the
    "License"); you may not use this file except in compliance
    with the License.  You may obtain a copy of the License at
    http://www.apache.org/licenses/LICENSE-2.0
    Unless required by applicable law or agreed to in writing,
    software distributed under the License is distributed on an
    "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
    KIND, either express or implied.  See the License for the
    specific language governing permissions and limitations
    under the License.
*/

var helpers = require('../spec/helpers');
var path = require('path');
var fs = require('fs-extra');
var superspawn = require('cordova-common').superspawn;
var config = require('../src/cordova/config');
var Q = require('q');
var events = require('cordova-common').events;
var cordova = require('../src/cordova/cordova');
var rewire = require('rewire');
var plugman = require('../src/plugman/plugman');
var platform = rewire('../src/cordova/platform');
var addHelper = rewire('../src/cordova/platform/addHelper');
var fixturesDir = path.join(__dirname, '..', 'spec', 'cordova', 'fixtures');
var pluginsDir = path.join(fixturesDir, 'plugins');

describe('cordova/platform', () => {

    describe('platform end-to-end', () => {

        var tmpDir = helpers.tmpDir('platform_test');
        var project = path.join(tmpDir, 'project');

        var results;

        beforeEach(() => {
            fs.removeSync(tmpDir);

            fs.copySync(path.join(fixturesDir, 'base'), project);
            process.chdir(project);

            // Now we load the config.json in the newly created project and edit the target platform's lib entry
            // to point at the fixture version. This is necessary so that cordova.prepare can find cordova.js there.
            var c = config.read(project);
            c.lib[helpers.testPlatform].url = path.join(fixturesDir, 'platforms', helpers.testPlatform + '-lib');
            config.write(project, c);

            // The config.json in the fixture project points at fake "local" paths.
            // Since it's not a URL, the lazy-loader will just return the junk path.
            spyOn(superspawn, 'spawn').and.callFake(cmd => {
                if (cmd.match(/create\b/)) {
                    // This is a call to the bin/create script, so do the copy ourselves.
                    fs.copySync(path.join(fixturesDir, 'platforms/android'), path.join(project, 'platforms/android'));
                } else if (cmd.match(/version\b/)) {
                    return Q('3.3.0');
                } else if (cmd.match(/update\b/)) {
                    fs.writeFileSync(path.join(project, 'platforms', helpers.testPlatform, 'updated'), 'I was updated!', 'utf-8');
                }
                return Q();
            });

            events.on('results', res => { results = res; });
        });

        afterEach(() => {
            process.chdir(path.join(__dirname, '..')); // Needed to rm the dir on Windows.
            fs.removeSync(tmpDir);
        });

        // Factoring out some repeated checks.
        function emptyPlatformList () {
            return cordova.platform('list').then(() => {
                var installed = results.match(/Installed platforms:\n {2}(.*)/);
                expect(installed).toBeDefined();
                expect(installed[1].indexOf(helpers.testPlatform)).toBe(-1);
            });
        }
        function fullPlatformList () {
            return cordova.platform('list').then(() => {
                var installed = results.match(/Installed platforms:\n {2}(.*)/);
                expect(installed).toBeDefined();
                expect(installed[1].indexOf(helpers.testPlatform)).toBeGreaterThan(-1);
            });
        }

        // The flows we want to test are add, rm, list, and upgrade.
        // They should run the appropriate hooks.
        // They should fail when not inside a Cordova project.
        // These tests deliberately have no beforeEach and afterEach that are cleaning things up.
        //
        // This test was designed to use a older version of android before API.js
        // It is not valid anymore.
        xit('Test 001 : should successfully run', () => {

            // Check there are no platforms yet.
            return emptyPlatformList()
                .then(() => {
                    // Add the testing platform.
                    return cordova.platform('add', [helpers.testPlatform]);
                })
                .then(() => {
                    // Check the platform add was successful.
                    expect(path.join(project, 'platforms', helpers.testPlatform)).toExist();
                    expect(path.join(project, 'platforms', helpers.testPlatform, 'cordova')).toExist();
                })
                .then(fullPlatformList) // Check for it in platform ls.
                .then(() => {
                    // Try to update the platform.
                    return cordova.platform('update', [helpers.testPlatform]);
                })
                .then(() => {
                    // Our fake update script in the exec mock above creates this dummy file.
                    expect(path.join(project, 'platforms', helpers.testPlatform, 'updated')).toExist();
                })
                .then(fullPlatformList) // Platform should still be in platform ls.
                .then(() => {
                    // And now remove it.
                    return cordova.platform('rm', [helpers.testPlatform]);
                })
                .then(() => {
                    // It should be gone.
                    expect(path.join(project, 'platforms', helpers.testPlatform)).not.toExist();
                })
                .then(emptyPlatformList); // platform ls should be empty too.;

        });

        xit('Test 002 : should install plugins correctly while adding platform', () => {
            return cordova.plugin('add', path.join(pluginsDir, 'test'))
                .then(() => {
                    return cordova.platform('add', [helpers.testPlatform]);
                })
                .then(() => {
                    // Check the platform add was successful.
                    expect(path.join(project, 'platforms', helpers.testPlatform)).toExist();
                    // Check that plugin files exists in www dir
                    expect(path.join(project, 'platforms', helpers.testPlatform, 'assets/www/test.js')).toExist();
                });
        }, 60000);

        xit('Test 003 : should call prepare after plugins were installed into platform', () => {
            var order = '';
            spyOn(plugman, 'install').and.callFake(() => { order += 'I'; });
            // below line won't work since prepare is inline require in addHelper, not global
            var x = addHelper.__set__('prepare', () => { order += 'P'; }); // eslint-disable-line no-unused-vars
            // spyOn(prepare).and.callFake(function() { console.log('prepare'); order += 'P'; });
            return cordova.plugin('add', path.join(pluginsDir, 'test'))
                .then(() => {
                    return platform('add', [helpers.testPlatform]);
                })
                .then(() => {
                    expect(order).toBe('IP'); // Install first, then prepare
                });
        });
    });

    describe('platform add plugin rm end-to-end', () => {

        var tmpDir = helpers.tmpDir('plugin_rm_test');
        var project = path.join(tmpDir, 'hello');
        var pluginsDir = path.join(project, 'plugins');

        beforeEach(() => {
            process.chdir(tmpDir);
        });

        afterEach(() => {
            process.chdir(path.join(__dirname, '..')); // Needed to rm the dir on Windows.
            fs.removeSync(tmpDir);
        });

        it('Test 006 : should remove dependency when removing parent plugin', () => {

            return cordova.create('hello')
                .then(() => {
                    process.chdir(project);
                    return cordova.platform('add', 'browser@latest');
                })
                .then(() => {
                    return cordova.plugin('add', 'cordova-plugin-media');
                })
                .then(() => {
                    expect(path.join(pluginsDir, 'cordova-plugin-media')).toExist();
                    expect(path.join(pluginsDir, 'cordova-plugin-file')).toExist();
                    return cordova.platform('add', 'android');
                })
                .then(() => {
                    expect(path.join(pluginsDir, 'cordova-plugin-media')).toExist();
                    expect(path.join(pluginsDir, 'cordova-plugin-file')).toExist();
                    return cordova.plugin('rm', 'cordova-plugin-media');
                })
                .then(() => {
                    expect(path.join(pluginsDir, 'cordova-plugin-media')).not.toExist();
                    expect(path.join(pluginsDir, 'cordova-plugin-file')).not.toExist();
                });
        }, 100000);
    });

    describe('platform add and remove --fetch', () => {

        var tmpDir = helpers.tmpDir('plat_add_remove_fetch_test');
        var project = path.join(tmpDir, 'helloFetch');
        var platformsDir = path.join(project, 'platforms');
        var nodeModulesDir = path.join(project, 'node_modules');

        beforeEach(() => {
            process.chdir(tmpDir);
        });

        afterEach(() => {
            process.chdir(path.join(__dirname, '..')); // Needed to rm the dir on Windows.
            fs.removeSync(tmpDir);
        });

        it('Test 007 : should add and remove platform from node_modules directory', () => {

            return cordova.create('helloFetch')
                .then(() => {
                    process.chdir(project);
                    return cordova.platform('add', 'browser', {'save': true});
                })
                .then(() => {
                    expect(path.join(nodeModulesDir, 'cordova-browser')).toExist();
                    expect(path.join(platformsDir, 'browser')).toExist();
                    return cordova.platform('add', 'android');
                })
                .then(() => {
                    expect(path.join(nodeModulesDir, 'cordova-browser')).toExist();
                    expect(path.join(platformsDir, 'android')).toExist();
                    // Tests finish before this command finishes resolving
                    // return cordova.platform('rm', 'ios');
                })
                .then(() => {
                    // expect(path.join(nodeModulesDir, 'cordova-ios')).not.toExist();
                    // expect(path.join(platformsDir, 'ios')).not.toExist();
                    // Tests finish before this command finishes resolving
                    // return cordova.platform('rm', 'android');
                })
                .then(() => {
                    // expect(path.join(nodeModulesDir, 'cordova-android')).not.toExist();
                    // expect(path.join(platformsDir, 'android')).not.toExist();
                });
        }, 100000);
    });

    describe('plugin add and rm end-to-end --fetch', () => {

        var tmpDir = helpers.tmpDir('plugin_rm_fetch_test');
        var project = path.join(tmpDir, 'hello3');
        var pluginsDir = path.join(project, 'plugins');

        beforeEach(() => {
            process.chdir(tmpDir);
        });

        afterEach(() => {
            process.chdir(path.join(__dirname, '..')); // Needed to rm the dir on Windows.
            fs.removeSync(tmpDir);
        });

        it('Test 008 : should remove dependency when removing parent plugin', () => {

            return cordova.create('hello3')
                .then(() => {
                    process.chdir(project);
                    return cordova.platform('add', 'browser');
                })
                .then(() => {
                    return cordova.plugin('add', 'cordova-plugin-media', {'save': true});
                })
                .then(() => {
                    expect(path.join(pluginsDir, 'cordova-plugin-media')).toExist();
                    expect(path.join(pluginsDir, 'cordova-plugin-file')).toExist();
                    expect(path.join(project, 'node_modules', 'cordova-plugin-media')).toExist();
                    expect(path.join(project, 'node_modules', 'cordova-plugin-file')).toExist();
                    return cordova.platform('add', 'android');
                })
                .then(() => {
                    expect(path.join(pluginsDir, 'cordova-plugin-media')).toExist();
                    expect(path.join(pluginsDir, 'cordova-plugin-file')).toExist();
                    return cordova.plugin('rm', 'cordova-plugin-media');
                })
                .then(() => {
                    expect(path.join(pluginsDir, 'cordova-plugin-media')).not.toExist();
                    expect(path.join(pluginsDir, 'cordova-plugin-file')).not.toExist();
                    // These don't work yet due to the tests finishing before the promise resolves.
                    // expect(path.join(project, 'node_modules', 'cordova-plugin-media')).not.toExist();
                    // expect(path.join(project, 'node_modules', 'cordova-plugin-file')).not.toExist();
                    // expect(path.join(project, 'node_modules', 'cordova-plugin-compat')).not.toExist();
                });
        }, 60000);
    });

    describe('non-core platform add and rm end-to-end --fetch', () => {

        var tmpDir = helpers.tmpDir('non-core-platform-test');
        var project = path.join(tmpDir, 'hello');
        var results;

        beforeEach(() => {
            process.chdir(tmpDir);
            events.on('results', res => { results = res; });
        });

        afterEach(() => {
            process.chdir(path.join(__dirname, '..')); // Needed to rm the dir on Windows.
            fs.removeSync(tmpDir);
        });

        it('Test 009 : should add and remove 3rd party platforms', () => {
            var installed;
            return cordova.create('hello')
                .then(() => {
                    process.chdir(project);
                    // add cordova-android instead of android
                    return cordova.platform('add', 'cordova-android');
                })
                .then(() => {
                    // 3rd party platform from npm
                    return cordova.platform('add', 'cordova-platform-test');
                })
                .then(() => {
                    expect(path.join(project, 'platforms', 'android')).toExist();
                    expect(path.join(project, 'platforms', 'cordova-platform-test')).toExist();
                    return cordova.platform('ls');
                })
                .then(() => {
                    // use regex to grab installed platforms
                    installed = results.match(/Installed platforms:\n {2}(.*)\n {2}(.*)/);
                    expect(installed).toBeDefined();
                    expect(installed[1].indexOf('android')).toBeGreaterThan(-1);
                    expect(installed[2].indexOf('cordova-platform-test')).toBeGreaterThan(-1);
                });
        }, 90000);
    });
});
