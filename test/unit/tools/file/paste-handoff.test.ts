import { describe, it, expect } from 'vitest';
import { FileTool } from '../../../../src/tools/file';
import { AudioTool } from '../../../../src/tools/audio';

describe('audio paste routing', () => {
  it('the File tool no longer claims audio MIME types', () => {
    const mimes = FileTool.pasteConfig.files?.mimeTypes ?? [];
    expect(mimes).not.toContain('audio/*');
  });
  it('the File tool no longer claims audio extensions', () => {
    const exts = FileTool.pasteConfig.files?.extensions ?? [];
    expect(exts).not.toEqual(expect.arrayContaining(['mp3', 'wav', 'ogg']));
  });
  it('the Audio tool claims audio MIME types', () => {
    expect(AudioTool.pasteConfig.files?.mimeTypes).toContain('audio/*');
  });
});
