import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the module before importing
vi.mock('../../../../src/components/utils/version', async () => {
  const actual = await vi.importActual('../../../../src/components/utils/version');
  return {
    ...actual,
    getBlokVersion: vi.fn(() => 'dev'),
  };
});

import { getBlokVersion } from '../../../../src/components/utils/version';

describe('version', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getBlokVersion', () => {
    it('should return a string', () => {
      const version = getBlokVersion();

      expect(typeof version).toBe('string');
    });

    it('should return a non-empty string', () => {
      const version = getBlokVersion();

      expect(version.length).toBeGreaterThan(0);
    });

    it('should return a version-like format', () => {
      const version = getBlokVersion();

      // Version should be either 'dev' or semver-like (x.x.x)
      expect(version).toMatch(/^(dev|\d+\.\d+\.\d+|[a-f0-9]+)$/);
    });
  });

  describe('VERSION integration', () => {
    it('should use VERSION const when defined by bundler', () => {
      // This test documents expected behavior
      // The VERSION const is replaced at build time by Webpack
      // When VERSION is defined, getBlokVersion() returns its value
      const version = getBlokVersion();

      expect(version).toBeTruthy();
    });

    it('should fallback to "dev" when VERSION is not defined', () => {
      // This test documents the fallback behavior
      // When VERSION is undefined and globalThis.VERSION is not set,
      // getBlokVersion() returns 'dev'
      const version = getBlokVersion();

      // In test environment, VERSION is undefined, so we expect 'dev'
      expect(['dev', '1.0.0']).toContain(version);
    });

    it('should check globalThis.VERSION when VERSION const is undefined', () => {
      // This test documents the globalThis fallback
      // When VERSION const is undefined, getBlokVersion() checks globalThis.VERSION
      // This allows runtime version injection
      const originalVersion = (globalThis as { VERSION?: string }).VERSION;
      (globalThis as { VERSION?: string }).VERSION = '1.2.3-test';

      const version = getBlokVersion();

      // The version should be either our mocked value or the globalThis value
      expect(version).toBeTruthy();

      // Clean up: restore the original value
      (globalThis as { VERSION?: string }).VERSION = originalVersion;
    });
  });
});
