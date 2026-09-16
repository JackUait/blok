/**
 * The embed registry is the only place that knows which URL shapes a provider
 * claims and what embed URL they become. A host migrating stored legacy links
 * has to reproduce exactly what a live paste produces, so `matchEmbedService`
 * and `buildEmbedUrl` must be reachable from the published `./tools` entry —
 * otherwise every host hand-maintains YouTube/VK/Google/drawio patterns that
 * rot silently against this file.
 *
 * `EMBED_SERVICES` itself stays private on purpose: it is a ~1700-line data
 * structure whose keys, regexes and embed templates change whenever a provider
 * changes, and freezing it as a public surface would make every such change a
 * semver event. The two functions cover the whole use case.
 */
import { describe, expect, it } from 'vitest';

import * as toolsEntry from '../../../../src/tools';
import { EMBED_SERVICES } from '../../../../src/tools/link/registry';

describe('embed registry reachable from the ./tools entry', () => {
  it('exports matchEmbedService', () => {
    expect(typeof toolsEntry.matchEmbedService).toBe('function');
  });

  it('exports buildEmbedUrl', () => {
    expect(typeof toolsEntry.buildEmbedUrl).toBe('function');
  });

  it('matches a provider URL to the same shape a live paste stores', () => {
    const match = toolsEntry.matchEmbedService('https://www.youtube.com/watch?v=dQw4w9WgXcQ');

    expect(match).not.toBeNull();
    expect(match?.service).toBe('youtube');
    expect(match?.remoteId).toBe('dQw4w9WgXcQ');
    expect(match?.embedUrl).toContain('dQw4w9WgXcQ');
    expect(match?.kind).toBe('iframe');
  });

  it('returns null for a URL no provider claims', () => {
    expect(toolsEntry.matchEmbedService('https://example.com/not-an-embed')).toBeNull();
  });

  it('builds an embed URL for a registered service', () => {
    expect(toolsEntry.buildEmbedUrl('youtube', 'dQw4w9WgXcQ')).toBe(
      toolsEntry.matchEmbedService('https://www.youtube.com/watch?v=dQw4w9WgXcQ')?.embedUrl
    );
  });

  it('throws for an unregistered service', () => {
    expect(() => toolsEntry.buildEmbedUrl('not-a-service', 'x')).toThrow(/Unknown embed service/);
  });

  it('keeps the registry data structure itself private', () => {
    expect(EMBED_SERVICES).toBeDefined();
    expect('EMBED_SERVICES' in toolsEntry).toBe(false);
  });
});
