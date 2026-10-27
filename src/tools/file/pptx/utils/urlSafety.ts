// Derived from @aiden0z/pptx-renderer 1.4.0 (Apache-2.0); modified for Blok. See NOTICE.
/**
 * URL safety utilities for external hyperlinks/media in untrusted PPTX content.
 */

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

function getUrlProtocol(url: string): string | undefined {
  try {
    return new URL(url).protocol.toLowerCase();
  } catch {
    return undefined;
  }
}

/**
 * Returns true only for absolute URLs with an allowed protocol.
 */
export function isAllowedExternalUrl(url: string): boolean {
  const protocol = getUrlProtocol(url);
  return protocol !== undefined && ALLOWED_PROTOCOLS.has(protocol);
}

