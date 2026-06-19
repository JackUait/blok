import { describe, it, expect, vi } from 'vitest';
import type { API } from '../../../../types';
import type { ImageConfig } from '../../../../types/tools/image';
import { resolveConvertedUploader } from '../../../../src/tools/image/converted-uploader';

const apiWithVideo = (videoConfig: unknown): API => ({
  tools: { getToolsConfig: () => ({ tools: { video: { class: class {}, config: videoConfig } } }) },
} as unknown as API);

const apiNoVideo = (): API => ({
  tools: { getToolsConfig: () => ({ tools: {} }) },
} as unknown as API);

describe('resolveConvertedUploader', () => {
  it('prefers the video tool uploadByFile when present', () => {
    const videoUpload = vi.fn();
    const fn = resolveConvertedUploader(apiWithVideo({ uploader: { uploadByFile: videoUpload } }), {});
    expect(fn).toBe(videoUpload);
  });

  it('falls back to the image uploadByFile when no video uploader', () => {
    const imageUpload = vi.fn();
    const config: ImageConfig = { uploader: { uploadByFile: imageUpload } };
    expect(resolveConvertedUploader(apiNoVideo(), config)).toBe(imageUpload);
  });

  it('also falls back to image uploader when the video tool has no uploadByFile', () => {
    const imageUpload = vi.fn();
    const fn = resolveConvertedUploader(apiWithVideo({ types: ['video/mp4'] }), { uploader: { uploadByFile: imageUpload } });
    expect(fn).toBe(imageUpload);
  });

  it('returns undefined when neither uploader exists', () => {
    expect(resolveConvertedUploader(apiNoVideo(), {})).toBeUndefined();
  });
});
