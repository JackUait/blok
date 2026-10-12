// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { validateAgainst } from '../../../../src/shared/schema/validate';
import { BUILT_IN_TOOL_RUNTIMES } from '../../../../src/shared/tool-actions';
import { MEDIA_ACTION_HANDLERS } from '../../../../src/shared/tool-actions/media';
import { describeAudio } from '../../../../src/shared/tool-descriptions/audio';
import { describeFile } from '../../../../src/shared/tool-descriptions/file';
import { describeImage } from '../../../../src/shared/tool-descriptions/image';
import { describeVideo } from '../../../../src/shared/tool-descriptions/video';
import { createFakeCtx, docOf, FakeFailure } from './fake-ctx';

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('media setSource', () => {
  it('re-hosts through the uploader when there is one', async () => {
    const uploadByUrl = vi.fn().mockResolvedValue({ url: 'https://cdn/x.png', fileName: 'x.png' });
    const action = MEDIA_ACTION_HANDLERS.image.setSource;
    const prepared = await action.prepare?.({ services: { uploader: { uploadByUrl } } }, { url: 'https://a.b/x.png' });
    const ctx = createFakeCtx(docOf([{ id: 'i', type: 'image', data: { url: '' } }]), 'i');

    action.run(ctx, { url: 'https://a.b/x.png' }, prepared);

    expect(uploadByUrl).toHaveBeenCalledWith('https://a.b/x.png', { kind: 'image', tool: 'image' });
    expect(ctx.read('i')?.data).toEqual({ url: 'https://cdn/x.png', fileName: 'x.png' });
  });

  it('a new image source drops the stale variants and keeps the crop', async () => {
    const action = MEDIA_ACTION_HANDLERS.image.setSource;
    const ctx = createFakeCtx(docOf([{ id: 'i', type: 'image', data: { url: 'old', variants: [{ url: 'old', mimeType: 'image/png' }], crop: { x: 1, y: 1, w: 50, h: 50 } } }]), 'i');

    action.run(ctx, { url: 'https://a.b/new.png' }, await action.prepare?.({ services: {} }, { url: 'https://a.b/new.png' }));

    expect(ctx.read('i')?.data).toEqual({ url: 'https://a.b/new.png', crop: { x: 1, y: 1, w: 50, h: 50 } });
  });

  it('stores the URL as given without an uploader, or with one that cannot take URLs', async () => {
    const action = MEDIA_ACTION_HANDLERS.video.setSource;
    const prepared = await action.prepare?.({ services: { uploader: {} } }, { url: 'https://a.b/v.mp4' });
    const ctx = createFakeCtx(docOf([{ id: 'v', type: 'video', data: { url: '' } }]), 'v');

    action.run(ctx, { url: 'https://a.b/v.mp4' }, prepared);

    expect(ctx.read('v')?.data).toEqual({ url: 'https://a.b/v.mp4' });
  });

  it('keeps audio and file data besides the source, and writes no variants there', async () => {
    const uploadByUrl = vi.fn().mockResolvedValue({ url: 'https://cdn/s.mp3' });
    const action = MEDIA_ACTION_HANDLERS.audio.setSource;
    const ctx = createFakeCtx(docOf([{ id: 'a', type: 'audio', data: { url: 'old', title: 'T' } }]), 'a');

    action.run(ctx, { url: 'https://a.b/s.mp3' }, await action.prepare?.({ services: { uploader: { uploadByUrl } } }, { url: 'https://a.b/s.mp3' }));

    expect(uploadByUrl).toHaveBeenCalledWith('https://a.b/s.mp3', { kind: 'audio', tool: 'audio' });
    expect(ctx.read('a')?.data).toEqual({ url: 'https://cdn/s.mp3', title: 'T' });
    expect(ctx.edits).toEqual([{ op: 'update', id: 'a', patch: { url: 'https://cdn/s.mp3' } }]);
  });

  it('refuses a non-http URL before any host work', async () => {
    const uploadByUrl = vi.fn();

    await expect(MEDIA_ACTION_HANDLERS.file.setSource.prepare?.({ services: { uploader: { uploadByUrl } } }, { url: 'javascript:alert(1)' })).rejects.toBeInstanceOf(Error);
    expect(uploadByUrl).not.toHaveBeenCalled();
    expect(() => MEDIA_ACTION_HANDLERS.file.setSource.run(createFakeCtx(docOf([{ id: 'f', type: 'file', data: {} }]), 'f'), { url: 'javascript:alert(1)' }, undefined)).toThrow(FakeFailure);
  });

  it('sets an audio cover, re-hosted as an image', async () => {
    const uploadByUrl = vi.fn().mockResolvedValue({ url: 'https://cdn/c.png', fileName: 'c.png' });
    const action = MEDIA_ACTION_HANDLERS.audio.setCover;
    const ctx = createFakeCtx(docOf([{ id: 'a', type: 'audio', data: { url: 'u' } }]), 'a');

    action.run(ctx, { url: 'https://a.b/c.png' }, await action.prepare?.({ services: { uploader: { uploadByUrl } } }, { url: 'https://a.b/c.png' }));

    expect(uploadByUrl).toHaveBeenCalledWith('https://a.b/c.png', { kind: 'image', tool: 'audio' });
    expect(ctx.read('a')?.data).toEqual({ url: 'u', coverUrl: 'https://cdn/c.png' });
  });
});

describe('media action declarations', () => {
  it.each([
    ['image', describeImage, ['setSource']],
    ['video', describeVideo, ['setSource']],
    ['audio', describeAudio, ['setSource', 'setCover']],
    ['file', describeFile, ['setSource']],
  ] as const)('%s declares URL-only actions that use the uploader', (tool, describe, names) => {
    const actions = describe().actions ?? [];

    for (const name of names) {
      const action = actions.find(candidate => candidate.name === name);

      expect(action).toMatchObject({ target: 'block', uses: ['uploader'] });
      expect(validateAgainst(action?.args ?? {}, { url: 'https://a.b/x' })).toEqual([]);
      expect(validateAgainst(action?.args ?? {}, { url: 'javascript:alert(1)' }).length).toBeGreaterThan(0);
      expect(validateAgainst(action?.args ?? {}, {}).length).toBeGreaterThan(0);
      expect(BUILT_IN_TOOL_RUNTIMES.get(tool)?.actions[name]).toBeDefined();
    }
  });
});
