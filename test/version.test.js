'use strict';
// The app shows the version from package.json, never a number typed into the code.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('the shown version comes from package.json', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'main.js'), 'utf8');
  assert.match(main, /const VERSION = require\('\.\.\/\.\.\/package\.json'\)\.version/);
  assert.doesNotMatch(main, /const VERSION = '\d/);
  assert.equal(require('../package.json').version.replace(/\.0$/, ''), '0.5');
});
