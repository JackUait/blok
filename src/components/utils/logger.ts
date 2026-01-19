/**
 * Logging utilities for Blok editor
 */

import { getBlokVersion } from './version';

/**
 * Possible log levels
 */
export enum LogLevels {
  VERBOSE = 'VERBOSE',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
}

/**
 * Type representing callable console methods
 */
type ConsoleMethod = {
  [K in keyof Console]: Console[K] extends (...args: unknown[]) => unknown ? K : never;
}[keyof Console];

/**
 * Custom logger
 * @param labeled — if true, Blok label is shown
 * @param msg - message
 * @param type - logging type 'log'|'warn'|'error'|'info'
 * @param args - argument to log with a message
 * @param style - additional styling to message
 */
const _log = (
  labeled: boolean,
  msg: string,
  type: ConsoleMethod = 'log',
  args?: unknown,
  style = 'color: inherit'
): void => {
  const consoleRef: Console | undefined = typeof console === 'undefined' ? undefined : console;

  if (!consoleRef || typeof consoleRef[type] !== 'function') {
    return;
  }

  const isSimpleType = ['info', 'log', 'warn', 'error'].includes(type);
  const argsToPass: unknown[] = [];

  switch (_log.logLevel) {
    case LogLevels.VERBOSE:
      // VERBOSE logs everything, no early return
      break;

    case LogLevels.ERROR:
      if (type !== 'error') {
        return;
      }
      break;

    case LogLevels.WARN:
      if (!['error', 'warn'].includes(type)) {
        return;
      }
      break;

    case LogLevels.INFO:
      if (!isSimpleType || labeled) {
        return;
      }
      break;
  }

  if (args) {
    argsToPass.push(args);
  }

  const blokLabelText = `Blok ${getBlokVersion()}`;
  const blokLabelStyle = `line-height: 1em;
            color: #006FEA;
            display: inline-block;
            font-size: 11px;
            line-height: 1em;
            background-color: #fff;
            padding: 4px 9px;
            border-radius: 30px;
            border: 1px solid rgba(56, 138, 229, 0.16);
            margin: 4px 5px 4px 0;`;

  const formattedMessage = (() => {
    if (!labeled) {
      return msg;
    }

    if (isSimpleType) {
      argsToPass.unshift(blokLabelStyle, style);

      return `%c${blokLabelText}%c ${msg}`;
    }

    return `( ${blokLabelText} )${msg}`;
  })();

  const callArguments = (() => {
    if (!isSimpleType) {
      return [ formattedMessage ];
    }

    if (args !== undefined) {
      return [`${formattedMessage} %o`, ...argsToPass];
    }

    return [formattedMessage, ...argsToPass];
  })();

  try {
    consoleRef[type](...callArguments);
  } catch (_ignored) {}
};

/**
 * Current log level
 */
_log.logLevel = LogLevels.VERBOSE;

/**
 * Set current log level
 * @param logLevel - log level to set
 */
export const setLogLevel = (logLevel: LogLevels): void => {
  _log.logLevel = logLevel;
};

/**
 * _log method proxy without Blok label
 * @param msg - message to log
 * @param type - console method name
 * @param args - optional payload to pass to console
 * @param style - optional css style for the first argument
 */
export const log = (
  msg: string,
  type: ConsoleMethod = 'log',
  args?: unknown,
  style?: string
): void => {
  _log(false, msg, type, args, style);
};

/**
 * _log method proxy with Blok label
 * @param msg - message to log
 * @param type - console method name
 * @param args - optional payload to pass to console
 * @param style - optional css style for the first argument
 */
export const logLabeled = (
  msg: string,
  type: ConsoleMethod = 'log',
  args?: unknown,
  style?: string
): void => {
  _log(true, msg, type, args, style);
};
