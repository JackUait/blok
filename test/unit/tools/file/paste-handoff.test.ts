import { describe, it, expect } from 'vitest';
import { FileTool } from '../../../../src/tools/file';
import { AudioTool } from '../../../../src/tools/audio';

describe('audio paste routing', () => {
  it('the File tool no longer claims audio MIME types', () => {
    const pc = FileTool.pasteConfig;
    const mimes = pc !== false ? (pc.files?.mimeTypes ?? []) : [];
    expect(mimes).not.toContain('audio/*');
  });
  it('the File tool no longer claims audio extensions', () => {
    const pc = FileTool.pasteConfig;
    const exts = pc !== false ? (pc.files?.extensions ?? []) : [];
    expect(exts).not.toEqual(expect.arrayContaining(['mp3', 'wav', 'ogg']));
  });
  it('the Audio tool claims audio MIME types', () => {
    const pc = AudioTool.pasteConfig;
    if (pc === false) throw new Error('pasteConfig is false');
    expect(pc.files?.mimeTypes).toContain('audio/*');
  });
});
