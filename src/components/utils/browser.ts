/**
 * Browser and environment detection utilities
 */

type UniversalScope = {
  window?: Window;
  document?: Document;
  navigator?: Navigator;
};

const globalScope: UniversalScope | undefined = (() => {
  try {
    // Use indirect eval to get the global object in any environment
    // eslint-disable-next-line no-new-func
    const globalFactory = new Function('return this') as () => unknown;

    return globalFactory() as UniversalScope;
  } catch {
    return undefined;
  }
})();

if (globalScope && typeof globalScope.window === 'undefined') {
  (globalScope as Record<string, unknown>).window = globalScope;
}

/**
 * Returns globally available window object if it exists.
 */
const getGlobalWindow = (): Window | undefined => {
  if (globalScope?.window) {
    return globalScope.window;
  }

  return undefined;
};

/**
 * Returns globally available navigator object if it exists.
 */
const getGlobalNavigator = (): Navigator | undefined => {
  if (globalScope?.navigator) {
    return globalScope.navigator;
  }

  const win = getGlobalWindow();

  return win?.navigator;
};

/**
 * Make array from array-like collection
 */
export const array = <T extends unknown>(collection: ArrayLike<T>): T[] => {
  return Array.from(collection);
};

/**
 * Get file extension
 */
export const getFileExtension = (file: File): string => {
  return file.name.split('.').pop() ?? '';
};

/**
 * Check if string is MIME type
 */
export const isValidMimeType = (type: string): boolean => {
  return /^[-\w]+\/([-+\w]+|\*)$/.test(type);
};

/**
 * Returns object with os name as key and boolean as value. Shows current user OS
 */
export const getUserOS = (): {[key: string]: boolean} => {
  const OS: {[key: string]: boolean} = {
    win: false,
    mac: false,
    x11: false,
    linux: false,
  };

  const navigatorRef = getGlobalNavigator();
  const userAgent = navigatorRef?.userAgent?.toLowerCase() ?? '';
  const userOS = userAgent ? Object.keys(OS).find((os: string) => userAgent.indexOf(os) !== -1) : undefined;

  if (userOS !== undefined) {
    OS[userOS] = true;

    return OS;
  }

  return OS;
};

/**
 * All screens below this width will be treated as mobile
 */
export const MOBILE_SCREEN_BREAKPOINT = 650;

/**
 * True if screen has mobile size
 */
export const isMobileScreen = (): boolean => {
  const win = getGlobalWindow();

  if (!win || typeof win.matchMedia !== 'function') {
    return false;
  }

  return win.matchMedia(`(max-width: ${MOBILE_SCREEN_BREAKPOINT}px)`).matches;
};

/**
 * True if current device runs iOS
 */
export const isIosDevice = (() => {
  const navigatorRef = getGlobalNavigator();

  if (!navigatorRef) {
    return false;
  }

  const userAgent = navigatorRef.userAgent || '';

  // Use modern User-Agent Client Hints API if available
  const userAgentData = (navigatorRef as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
  const platform = userAgentData?.platform;

  // Check userAgent string first (most reliable method)
  if (/iP(ad|hone|od)/.test(userAgent)) {
    return true;
  }

  // Check platform from User-Agent Client Hints API if available
  if (platform !== undefined && platform !== '' && /iP(ad|hone|od)/.test(platform)) {
    return true;
  }

  // Check for iPad on iOS 13+ (reports as MacIntel with touch support)
  // Only access deprecated platform property when necessary
  const hasTouchSupport = (navigatorRef.maxTouchPoints ?? 0) > 1;
  const getLegacyPlatform = (): string | undefined =>
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- Fallback for older browsers that don't support User-Agent Client Hints
    (navigatorRef as Navigator & { platform?: string })['platform'];
  const platformHint = platform !== undefined && platform !== '' ? platform : undefined;
  const platformValue = hasTouchSupport ? platformHint ?? getLegacyPlatform() : undefined;

  if (platformValue === 'MacIntel') {
    return true;
  }

  return false;
})();

/**
 * Returns valid URL. If it is going outside and valid, it returns itself
 * If url has `one slash`, then it concatenates with window location origin
 * or when url has `two lack` it appends only protocol
 */
export const getValidUrl = (url: string): string => {
  try {
    const urlObject = new URL(url);

    return urlObject.href;
  } catch (_e) {
    // do nothing but handle below
  }

  const win = getGlobalWindow();

  if (url.substring(0, 2) === '//') {
    return win ? `${win.location.protocol}${url}` : url;
  }

  return win ? `${win.location.origin}${url}` : url;
};

/**
 * Opens new Tab with passed URL
 */
export const openTab = (url: string): void => {
  const win = getGlobalWindow();

  if (!win) {
    return;
  }

  win.open(url, '_blank');
};

/**
 * Export getGlobalWindow for internal use
 */
export { getGlobalWindow, getGlobalNavigator };
