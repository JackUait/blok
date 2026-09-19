import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ImageTool } from '../../../src/tools/image';
import { VideoTool } from '../../../src/tools/video';
import { AudioTool } from '../../../src/tools/audio';
import { FileTool } from '../../../src/tools/file';
import { Embed } from '../../../src/tools/link/embed';
import { saveListItem } from '../../../src/tools/list/block-operations';
import type { API, BlockAPI } from '../../../types';
import type { ListItemData } from '../../../src/tools/list/types';

/**
 * Collab merges these block-data keys character by character by keeping a Y.Text
 * in the shared document. A non-string written to one of them falls through to a
 * whole-key `set` that permanently replaces the Y.Text, so the field never merges
 * again for the life of the document — silent and irreversible. Tools must never
 * emit a non-string for a widened key.
 */

const createMockApi = (): API => ({
  styles: { block: 'blok-block' },
  i18n: { t: (k: string) => k, has: () => false },
} as unknown as API);

const createMockBlock = (): BlockAPI => ({
  id: 'b1',
  name: 'x',
  holder: document.createElement('div'),
  dispatchChange: vi.fn(),
} as unknown as BlockAPI);

// Returns whatever the tool's constructor expects, so each call site stays
// untyped on purpose: the point is data that violates the declared types.
const options = <T>(data: Record<string, unknown>): T => ({
  data,
  config: {},
  api: createMockApi(),
  block: createMockBlock(),
  readOnly: false,
} as unknown as T);

const listData = (text: unknown): ListItemData => ({ text, style: 'unordered' }) as unknown as ListItemData;

const NON_STRINGS: Array<[string, unknown]> = [
  ['null', null],
  ['a number', 42],
  ['an object', { toString: () => 'obj' }],
  ['an array', ['a']],
];

const expectAbsentOrString = (out: Record<string, unknown>, key: string): void => {
  if (key in out) {
    expect(typeof out[key]).toBe('string');
  }
};

describe('widened collab text keys — tools never emit a non-string', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  describe.each(NON_STRINGS)('when the stored value is %s', (_label, bad) => {
    it('image save() keeps caption and alt string-or-absent', () => {
      const out = new ImageTool(options({ url: 'https://x/y.png', caption: bad, alt: bad })).save() as unknown as Record<string, unknown>;
      expectAbsentOrString(out, 'caption');
      expectAbsentOrString(out, 'alt');
    });

    it('video save() keeps caption string-or-absent', () => {
      const out = new VideoTool(options({ url: 'https://x/y.mp4', caption: bad })).save() as unknown as Record<string, unknown>;
      expectAbsentOrString(out, 'caption');
    });

    it('audio save() keeps caption, title and artist string-or-absent', () => {
      const out = new AudioTool(options({ url: 'https://x/y.mp3', caption: bad, title: bad, artist: bad })).save() as unknown as Record<string, unknown>;
      expectAbsentOrString(out, 'caption');
      expectAbsentOrString(out, 'title');
      expectAbsentOrString(out, 'artist');
    });

    it('file save() keeps caption string-or-absent', () => {
      const out = new FileTool(options({ url: 'https://x/y.pdf', caption: bad })).save() as unknown as Record<string, unknown>;
      expectAbsentOrString(out, 'caption');
    });

    it('embed save() keeps caption string-or-absent', () => {
      const out = new Embed(options({ service: 'youtube', source: 'https://x', embed: 'https://x', caption: bad })).save() as unknown as Record<string, unknown>;
      expectAbsentOrString(out, 'caption');
    });

    it('list saveListItem() keeps text a string when the element is missing', () => {
      const out = saveListItem(listData(bad), null, () => null) as unknown as Record<string, unknown>;
      expect(typeof out.text).toBe('string');
    });

    it('list saveListItem() keeps text a string when the content element is missing', () => {
      const out = saveListItem(listData(bad), document.createElement('div'), () => null) as unknown as Record<string, unknown>;
      expect(typeof out.text).toBe('string');
    });
  });

  describe('valid input is untouched', () => {
    it('image keeps a real caption and alt, and omits absent ones', () => {
      const out = new ImageTool(options({ url: 'u', caption: 'hi', alt: 'a' })).save() as unknown as Record<string, unknown>;
      expect(out.caption).toBe('hi');
      expect(out.alt).toBe('a');
      expect(new ImageTool(options({ url: 'u' })).save()).toEqual({ url: 'u' });
    });

    it('file still omits an empty caption and keeps a real one', () => {
      expect(new FileTool(options({ url: 'u', caption: '' })).save()).toEqual({ url: 'u' });
      expect((new FileTool(options({ url: 'u', caption: 'c' })).save() as Record<string, unknown>).caption).toBe('c');
    });

    it('audio keeps real title and artist, and omits absent ones', () => {
      const out = new AudioTool(options({ url: 'u', title: 't', artist: 'a' })).save() as unknown as Record<string, unknown>;
      expect(out.title).toBe('t');
      expect(out.artist).toBe('a');
      expect(new AudioTool(options({ url: 'u' })).save()).toEqual({ url: 'u' });
    });

    it('video and embed keep a real caption and omit an absent one', () => {
      expect((new VideoTool(options({ url: 'u', caption: 'c' })).save() as Record<string, unknown>).caption).toBe('c');
      expect(new VideoTool(options({ url: 'u' })).save()).toEqual({ url: 'u' });
      expect((new Embed(options({ service: 's', source: 'u', embed: 'u', caption: 'c' })).save() as Record<string, unknown>).caption).toBe('c');
      expect('caption' in new Embed(options({ service: 's', source: 'u', embed: 'u' })).save()).toBe(false);
    });

    it('list keeps a real text through the element-less path', () => {
      expect(saveListItem(listData('hello'), null, () => null)).toEqual({ text: 'hello', style: 'unordered' });
    });
  });
});
