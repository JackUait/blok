/**
 * Utilities for Blok editor
 *
 * This file re-exports utilities from specialized modules for backwards compatibility.
 * New code should import directly from the specific modules:
 *
 * - constants.ts - keyCodes, mouseButtons, MOBILE_SCREEN_BREAKPOINT
 * - logger.ts - log, logLabeled, setLogLevel, LogLevels
 * - type-guards.ts - isFunction, isObject, isString, isBoolean, isNumber, isUndefined, isEmpty, isPrintableKey
 * - functional.ts - debounce, throttle, delay
 * - browser.ts - array, getFileExtension, isValidMimeType, getUserOS, isMobileScreen, isIosDevice, getValidUrl, openTab
 * - string.ts - capitalize, beautifyShortcut
 * - object.ts - deepMerge, equals
 * - id-generator.ts - generateBlockId, generateId
 * - html.ts - stripFakeBackgroundElements
 * - version.ts - getBlokVersion
 * - decorators.ts - cacheable
 */

// Constants
export {
  keyCodes,
  mouseButtons,
} from './utils/constants';

// Logger
export { LogLevels, log, logLabeled, setLogLevel } from './utils/logger';

// Type guards
export {
  isFunction,
  isObject,
  isString,
  isBoolean,
  isNumber,
  isUndefined,
  isEmpty,
  isPrintableKey,
} from './utils/type-guards';

// Functional utilities
export {
  debounce,
  throttle,
  delay,
} from './utils/functional';

// Browser utilities
export {
  array,
  getFileExtension,
  isValidMimeType,
  getUserOS,
  isMobileScreen,
  isIosDevice,
  getValidUrl,
  openTab,
} from './utils/browser';

// String utilities
export {
  capitalize,
  beautifyShortcut,
} from './utils/string';

// Object utilities
export {
  deepMerge,
  equals,
} from './utils/object';

// ID generation
export {
  generateBlockId,
  generateId,
} from './utils/id-generator';

// HTML utilities
export {
  stripFakeBackgroundElements,
} from './utils/html';

// Version utilities
export {
  getBlokVersion,
} from './utils/version';

// Decorators
export {
  cacheable,
} from './utils/decorators';

// Re-export for backwards compatibility
export { MOBILE_SCREEN_BREAKPOINT as mobileScreenBreakpoint } from './utils/constants';
