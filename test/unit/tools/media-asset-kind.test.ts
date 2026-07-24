import { describe, it, expect } from 'vitest';
import { ImageTool } from '../../../src/tools/image';
import { VideoTool } from '../../../src/tools/video';
import { AudioTool } from '../../../src/tools/audio';
import { FileTool } from '../../../src/tools/file';

/**
 * Media tools declare a static `assetKind` so consumers can discover the
 * media-bearing tool set (via api.tools.getBlockTools()) and reconcile a saved
 * document's `data.url`s against a CDN — without hardcoding each tool's data
 * shape. See BlockToolConstructable.assetKind / BlockToolAdapter.assetKind.
 */
describe('media tools — assetKind marker', () => {
  it('every media tool advertises its asset kind', () => {
    expect(ImageTool.assetKind).toBe('image');
    expect(VideoTool.assetKind).toBe('video');
    expect(AudioTool.assetKind).toBe('audio');
    expect(FileTool.assetKind).toBe('file');
  });
});
