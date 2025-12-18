/**
 * Test file for CommonJS require
 * This file verifies that the package can be used with require()
 */

// CommonJS require
const Blok = require('@jackuait/blok');

// Verify require
if (typeof Blok !== 'function') {
  throw new Error('Blok is not a constructor function');
}

console.log('CommonJS require verified successfully');

module.exports = { Blok };
