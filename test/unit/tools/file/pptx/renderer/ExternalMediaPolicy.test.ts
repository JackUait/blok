// Derived from @aiden0z/pptx-renderer 1.4.0 tests (Apache-2.0); modified for Blok.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../helpers/domShims';
import {
  externalMediaOrigin,
  externalMediaPresentation,
} from '../fixtures/external-media-policy';
import { renderSlide } from '../../../../../../src/tools/file/pptx/renderer/SlideRenderer';

// Blok never fetches external media, so there is no `externalMedia` option to test.
describe('external media is never fetched', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([false, true])(
    'blocks every external media path with lazyMedia=%s and retains embedded images',
    async (lazy) => {
      const p = externalMediaPresentation(lazy);
      const handle = renderSlide(p, p.slides[0]);
      await handle.ready;
      expect(handle.element.outerHTML).not.toContain(externalMediaOrigin);
      expect(handle.element.querySelector('img[src^="blob:"]')).not.toBeNull();
      expect(handle.element.querySelector('video, audio')).toBeNull();
      handle.dispose();
    },
  );

  it.each([
    'picture',
    'linked',
    'background',
    'shape',
    'text',
    'group',
    'layout',
    'master',
    'poster',
    'video',
    'audio',
    'svg',
  ])('never writes the external %s URL into the slide', async (id) => {
    const p = externalMediaPresentation();
    const handle = renderSlide(p, p.slides[0]);
    await handle.ready;
    expect(handle.element.outerHTML).not.toContain(`${externalMediaOrigin}/${id}.png`);
    handle.dispose();
  });
});
