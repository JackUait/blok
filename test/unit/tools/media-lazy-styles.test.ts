import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { sheetsOfTools, toolSheets } from '../../../src/components/utils/lazy-styles';
import { AudioTool } from '../../../src/tools/audio';
import { FileTool } from '../../../src/tools/file';
import { ImageTool } from '../../../src/tools/image';
import { Bookmark } from '../../../src/tools/link/bookmark';
import { Embed } from '../../../src/tools/link/embed';
import { VideoTool } from '../../../src/tools/video';

describe('media stylesheet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    ['image', ImageTool],
    ['video', VideoTool],
    ['audio', AudioTool],
    ['file', FileTool],
    ['embed', Embed],
    ['bookmark', Bookmark],
  ])('%s declares the media sheet, so core loads it before its blocks render', (_name, tool) => {
    expect(toolSheets(tool)).toEqual(['media']);
  });

  it('a host subclass keeps the sheet', () => {
    class HostImage extends ImageTool {}

    expect(toolSheets(HostImage)).toEqual(['media']);
  });

  it('several media tools load the sheet once', () => {
    expect(sheetsOfTools({ image: ImageTool, video: { class: VideoTool }, file: FileTool })).toEqual(['media']);
  });
});
