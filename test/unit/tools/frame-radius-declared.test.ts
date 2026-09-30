/**
 * Every built-in block that draws a rounded frame at its edge declares it, so
 * the selection fill around it follows the frame instead of cutting a square
 * corner behind it.
 */
import { describe, expect, it } from 'vitest';

import { AudioTool } from '../../../src/tools/audio';
import { CalloutTool } from '../../../src/tools/callout';
import { CodeTool } from '../../../src/tools/code';
import { FileTool } from '../../../src/tools/file';
import { ImageTool } from '../../../src/tools/image';
import { Bookmark } from '../../../src/tools/link/bookmark';
import { Embed } from '../../../src/tools/link/embed';
import { Paragraph } from '../../../src/tools/paragraph';
import { Stub } from '../../../src/tools/stub';
import { VideoTool } from '../../../src/tools/video';

const readFrame = (tool: unknown): unknown => (tool as { frameRadius?: unknown }).frameRadius;

describe('built-in block frames', () => {
  it.each([
    ['callout', CalloutTool],
    ['code', CodeTool],
    ['stub', Stub],
    ['image', ImageTool],
    ['video', VideoTool],
    ['audio', AudioTool],
    ['file', FileTool],
    ['embed', Embed],
    ['bookmark', Bookmark],
  ])('%s declares the block frame radius', (_name, tool) => {
    expect(readFrame(tool)).toBe('var(--blok-radius-block)');
  });

  it('a square text block declares no frame', () => {
    expect(readFrame(Paragraph)).toBeUndefined();
  });
});
