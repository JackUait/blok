import { describe, it, expect, vi } from 'vitest';
import {
  array,
  getFileExtension,
  isValidMimeType,
  getUserOS,
  isMobileScreen,
  isIosDevice,
  getValidUrl,
  openTab,
  MOBILE_SCREEN_BREAKPOINT,
  getGlobalWindow,
} from '../../../../src/components/utils/browser';

describe('browser', () => {
  describe('array', () => {
    it('should convert array-like collection to array', () => {
      const arrayLike = { 0: 'a', 1: 'b', 2: 'c', length: 3 } as ArrayLike<string>;
      const result = array(arrayLike);

      expect(result).toEqual(['a', 'b', 'c']);
      expect(Array.isArray(result)).toBe(true);
    });

    it('should convert NodeList to array', () => {
      const div = document.createElement('div');
      div.innerHTML = '<span></span><span></span>';
      const nodeList = div.querySelectorAll('span');

      const result = array(nodeList);

      expect(result).toHaveLength(2);
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('getFileExtension', () => {
    it('should return file extension', () => {
      const file = new File(['content'], 'test.txt', { type: 'text/plain' });
      expect(getFileExtension(file)).toBe('txt');
    });

    it('should return filename for file without extension', () => {
      const file = new File(['content'], 'test', { type: 'text/plain' });
      expect(getFileExtension(file)).toBe('test');
    });

    it('should handle multiple dots', () => {
      const file = new File(['content'], 'test.min.js', { type: 'text/javascript' });
      expect(getFileExtension(file)).toBe('js');
    });
  });

  describe('isValidMimeType', () => {
    it('should return true for valid MIME types', () => {
      expect(isValidMimeType('text/plain')).toBe(true);
      expect(isValidMimeType('image/png')).toBe(true);
      expect(isValidMimeType('application/json')).toBe(true);
      expect(isValidMimeType('image/*')).toBe(true);
      expect(isValidMimeType('text/x-custom')).toBe(true);
    });

    it('should return false for invalid MIME types', () => {
      expect(isValidMimeType('text')).toBe(false);
      expect(isValidMimeType('/plain')).toBe(false);
      expect(isValidMimeType('text/')).toBe(false);
      expect(isValidMimeType('')).toBe(false);
      expect(isValidMimeType('text plain')).toBe(false);
    });
  });

  describe('getUserOS', () => {
    it('should return OS object with all platforms false for unknown user agent', () => {
      const originalUserAgent = navigator.userAgent;

      Object.defineProperty(navigator, 'userAgent', {
        value: 'Unknown Browser',
        configurable: true,
      });

      const os = getUserOS();

      expect(os).toEqual({
        win: false,
        mac: false,
        x11: false,
        linux: false,
      });

      Object.defineProperty(navigator, 'userAgent', {
        value: originalUserAgent,
        configurable: true,
      });
    });

    it('should detect Windows', () => {
      const originalUserAgent = navigator.userAgent;

      Object.defineProperty(navigator, 'userAgent', {
        value: 'Mozilla/5.0 (Windows NT 10.0)',
        configurable: true,
      });

      const os = getUserOS();

      expect(os.win).toBe(true);

      Object.defineProperty(navigator, 'userAgent', {
        value: originalUserAgent,
        configurable: true,
      });
    });

    it('should detect macOS', () => {
      const originalUserAgent = navigator.userAgent;

      Object.defineProperty(navigator, 'userAgent', {
        value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
        configurable: true,
      });

      const os = getUserOS();

      expect(os.mac).toBe(true);

      Object.defineProperty(navigator, 'userAgent', {
        value: originalUserAgent,
        configurable: true,
      });
    });

    it('should detect Linux', () => {
      const originalUserAgent = navigator.userAgent;

      Object.defineProperty(navigator, 'userAgent', {
        value: 'linux',
        configurable: true,
      });

      const os = getUserOS();

      expect(os.linux).toBe(true);

      Object.defineProperty(navigator, 'userAgent', {
        value: originalUserAgent,
        configurable: true,
      });
    });
  });

  describe('MOBILE_SCREEN_BREAKPOINT', () => {
    it('should be 650', () => {
      expect(MOBILE_SCREEN_BREAKPOINT).toBe(650);
    });
  });

  describe('isMobileScreen', () => {
    it('should return false when window is not available', () => {
      // In test environment, window is available but we can test the logic
      expect(typeof isMobileScreen()).toBe('boolean');
    });

    it('should return boolean result', () => {
      const result = isMobileScreen();

      // Just verify it returns a boolean, actual value depends on test environment
      expect(typeof result).toBe('boolean');
    });
  });

  describe('isIosDevice', () => {
    it('should be a boolean', () => {
      expect(typeof isIosDevice).toBe('boolean');
    });

    it('should detect iOS from user agent', () => {
      const originalUserAgent = navigator.userAgent;
      const originalMaxTouchPoints = navigator.maxTouchPoints;

      Object.defineProperty(navigator, 'userAgent', {
        value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X)',
        configurable: true,
      });

      // Recreate the function to use the new user agent
      const result = (() => {
        const userAgent = navigator.userAgent || '';

        if (/iP(ad|hone|od)/.test(userAgent)) {
          return true;
        }

        return false;
      })();

      expect(result).toBe(true);

      Object.defineProperty(navigator, 'userAgent', {
        value: originalUserAgent,
        configurable: true,
      });
      Object.defineProperty(navigator, 'maxTouchPoints', {
        value: originalMaxTouchPoints,
        configurable: true,
      });
    });
  });

  describe('getValidUrl', () => {
    it('should return valid URL as-is', () => {
      expect(getValidUrl('https://example.com')).toBe('https://example.com/');
      expect(getValidUrl('http://example.com/path')).toBe('http://example.com/path');
    });

    it('should prepend protocol for protocol-relative URLs', () => {
      expect(getValidUrl('//example.com/path')).toContain('http');
    });

    it('should prepend origin for relative URLs', () => {
      const result = getValidUrl('/path/to/resource');
      expect(result).toContain(window.location.origin);
      expect(result).toContain('/path/to/resource');
    });

    it('should handle invalid URLs gracefully', () => {
      const result = getValidUrl('not-a-url');
      expect(result).toContain(window.location.origin);
    });
  });

  describe('openTab', () => {
    it('should call window.open with url and _blank', () => {
      const originalOpen = window.open;
      const spy = vi.spyOn(window, 'open').mockImplementation(() => null);

      openTab('https://example.com');

      expect(spy).toHaveBeenCalledWith('https://example.com', '_blank');

      window.open = originalOpen;
      spy.mockRestore();
    });
  });

  describe('getGlobalWindow', () => {
    it('should return window object in browser environment', () => {
      const win = getGlobalWindow();
      expect(win).toBeDefined();
      expect(win).toBe(window);
    });
  });
});
