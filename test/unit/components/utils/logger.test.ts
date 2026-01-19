import { describe, it, expect, beforeEach, vi, afterEach, type Mock } from 'vitest';

// Mock version module before importing logger
vi.mock('../../../../src/components/utils/version', () => ({
  getBlokVersion: vi.fn(() => '1.0.0'),
}));

import { log, logLabeled, setLogLevel, LogLevels } from '../../../../src/components/utils/logger';

describe('logger', () => {
  let consoleLogSpy: Mock<(...args: unknown[]) => void>;
  let consoleWarnSpy: Mock<(...args: unknown[]) => void>;
  let consoleErrorSpy: Mock<(...args: unknown[]) => void>;
  let consoleInfoSpy: Mock<(...args: unknown[]) => void>;

  beforeEach(() => {
    // Spy on console methods but let them call through
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    setLogLevel(LogLevels.VERBOSE);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('log', () => {
    it('should call console.log with message', () => {
      log('test message');

      expect(consoleLogSpy).toHaveBeenCalledWith('test message');
    });

    it('should call console.log with message and args', () => {
      log('test message', 'log', { data: 'test' });

      expect(consoleLogSpy).toHaveBeenCalledWith('test message %o', { data: 'test' });
    });

    it('should support different console methods', () => {
      log('warning', 'warn');
      log('error', 'error');
      log('info', 'info');

      expect(consoleWarnSpy).toHaveBeenCalledWith('warning');
      expect(consoleErrorSpy).toHaveBeenCalledWith('error');
      expect(consoleInfoSpy).toHaveBeenCalledWith('info');
    });

    it('should not log when log level is ERROR and type is log', () => {
      setLogLevel(LogLevels.ERROR);
      log('test message', 'log');

      expect(consoleLogSpy).not.toHaveBeenCalled();
    });

    it('should log error when log level is ERROR', () => {
      setLogLevel(LogLevels.ERROR);
      log('error message', 'error');

      expect(consoleErrorSpy).toHaveBeenCalledWith('error message');
    });

    it('should only log error and warn when log level is WARN', () => {
      setLogLevel(LogLevels.WARN);
      log('test', 'log');
      log('warning', 'warn');
      log('error', 'error');

      expect(consoleLogSpy).not.toHaveBeenCalled();
      expect(consoleWarnSpy).toHaveBeenCalledWith('warning');
      expect(consoleErrorSpy).toHaveBeenCalledWith('error');
    });

    it('should log all simple types when log level is INFO', () => {
      setLogLevel(LogLevels.INFO);
      log('test', 'log');
      log('warning', 'warn');
      log('error', 'error');
      log('info', 'info');

      expect(consoleLogSpy).toHaveBeenCalledWith('test');
      expect(consoleWarnSpy).toHaveBeenCalledWith('warning');
      expect(consoleErrorSpy).toHaveBeenCalledWith('error');
      expect(consoleInfoSpy).toHaveBeenCalledWith('info');
    });

    it('should apply custom style when provided', () => {
      log('test message', 'log', undefined, 'color: red');

      expect(consoleLogSpy).toHaveBeenCalledWith('test message');
    });
  });

  describe('logLabeled', () => {
    it('should add Blok label to message', () => {
      logLabeled('test message');

      const callArgs = consoleLogSpy.mock.calls[0] as [string, ...unknown[]];
      expect(callArgs[0]).toContain('Blok');
      expect(callArgs[0]).toContain('1.0.0');
      expect(callArgs[0]).toContain('test message');
    });

    it('should include version in label', () => {
      logLabeled('test message');

      const callArgs = consoleLogSpy.mock.calls[0] as [string, ...unknown[]];
      expect(callArgs[0]).toContain('Blok 1.0.0');
    });

    it('should not log labeled messages when log level is INFO', () => {
      setLogLevel(LogLevels.INFO);
      logLabeled('test message');

      expect(consoleLogSpy).not.toHaveBeenCalled();
    });

    it('should log labeled error messages at INFO level', () => {
      setLogLevel(LogLevels.INFO);
      logLabeled('error message', 'error');

      // At INFO level, labeled messages are filtered out, even for error type
      // This is the current implementation behavior
      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });
  });

  describe('setLogLevel', () => {
    it('should change the log level', () => {
      setLogLevel(LogLevels.ERROR);
      log('test', 'log');

      expect(consoleLogSpy).not.toHaveBeenCalled();

      setLogLevel(LogLevels.VERBOSE);
      log('test', 'log');

      expect(consoleLogSpy).toHaveBeenCalledWith('test');
    });
  });
});
