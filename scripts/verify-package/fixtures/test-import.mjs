/**
 * Test file for ESM imports
 * This file exercises all export paths from the package
 */

// Default import
import Blok from '@jackuait/blok';

// Locales import
import { loadLocale } from '@jackuait/blok/locales';

// Verify default import
if (typeof Blok !== 'function') {
  throw new Error('Blok default export is not a constructor function');
}

// Verify loadLocale
if (typeof loadLocale !== 'function') {
  throw new Error('loadLocale is not a function');
}

console.log('ESM imports verified successfully');

export { Blok, loadLocale };
