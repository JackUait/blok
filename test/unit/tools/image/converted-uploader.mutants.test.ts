/**
 * Guards for the shape checks around the converted-WebM uploader lookup.
 *
 * Equivalent mutant (proven, not assumed):
 *   the `value !== null` half of the object guard forced to `true`. Its only
 *   effect is that the helper returns `null` where it returned `undefined`.
 *   The helper is module-private, and its two call sites read the result with
 *   `?.config` and with a `??` fallback, both of which treat null and undefined
 *   the same, so no input can separate the two.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveConvertedUploader, type ConvertedUploadFn } from '../../../../src/tools/image/converted-uploader';
import type { API } from '../../../../types';

const apiWithTools = (tools: unknown): API => ({
  tools: { getToolsConfig: () => ({ tools }) },
} as unknown as API);

describe('resolveConvertedUploader mutants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('ignores a video tool registered as a bare class, whatever it carries', () => {
    const videoUpload = vi.fn<ConvertedUploadFn>();
    const imageUpload = vi.fn<ConvertedUploadFn>();
    // A tool may be registered as the class itself; only a settings object or a
    // flat config object can hold an uploader.
    class VideoTool {
      public static uploader = { uploadByFile: videoUpload };
    }

    const resolved = resolveConvertedUploader(
      apiWithTools({ video: VideoTool }),
      { uploader: { uploadByFile: imageUpload } }
    );

    expect(resolved).not.toBe(videoUpload);
    expect(resolved).toBe(imageUpload);
  });

  it('survives an editor whose tools map is absent', () => {
    const imageUpload = vi.fn<ConvertedUploadFn>();

    expect(
      resolveConvertedUploader(apiWithTools(undefined), { uploader: { uploadByFile: imageUpload } })
    ).toBe(imageUpload);
  });
});
