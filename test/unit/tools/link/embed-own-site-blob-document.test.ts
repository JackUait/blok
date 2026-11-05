/**
 * @vitest-environment jsdom
 * @vitest-environment-options {"url": "blob:https://app.example.com/4f1c2a9e-0000-4000-8000-000000000000"}
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { canFrameGeneric, genericEmbedPolicy } from '../../../../src/tools/link/generic-embed-policy';
import { pageHosts } from '../../../../src/tools/link/host-pattern';

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// A host may mount the editor in a blob:, about:srcdoc or about:blank
// document. location.hostname is '' there, but the page still runs on the
// host's real origin and its frames still carry the host's cookies.
describe('own-site refusal in an editor document with no hostname', () => {
  it('does not frame the page\'s own origin', () => {
    expect(window.location.hostname).toBe('');

    expect(canFrameGeneric('https://app.example.com/settings', genericEmbedPolicy({ allowGenericEmbed: true }))).toBe(false);
  });

  it('still frames other sites', () => {
    expect(canFrameGeneric('https://other.example.org/', genericEmbedPolicy({ allowGenericEmbed: true }))).toBe(true);
  });

  it('counts no own host for an opaque origin', () => {
    vi.stubGlobal('origin', 'null');
    expect(window.origin).toBe('null');

    expect(pageHosts(['alias.test'])).toEqual(['alias.test']);
  });
});
