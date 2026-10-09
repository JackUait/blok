import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { validateAgainst } from '../../../../src/shared/schema/validate';
import { BUILT_IN_BLOCK_DESCRIPTIONS } from '../../../../src/shared/tool-descriptions';
import { AUDIO_DATA, describeAudio } from '../../../../src/shared/tool-descriptions/audio';
import { FILE_DATA, describeFile } from '../../../../src/shared/tool-descriptions/file';
import { IMAGE_DATA, describeImage } from '../../../../src/shared/tool-descriptions/image';
import { VIDEO_DATA, describeVideo } from '../../../../src/shared/tool-descriptions/video';
import { AudioTool } from '../../../../src/tools/audio';
import { FileTool } from '../../../../src/tools/file';
import { ImageTool } from '../../../../src/tools/image';
import { VideoTool } from '../../../../src/tools/video';
import { blokDocumentSchema } from '../../../../src/view/document-schema';
import type { ImageFilterDefinition } from '../../../../types/tools/image';
import type { BlokSchema, BlockToolDescription, DescribeBlockTool } from '../../../../types/tools/tool-description';

type MediaName = 'image' | 'video' | 'audio' | 'file';

const pinPath = resolve(__dirname, '../../view/__snapshots__/document-schema.json');
const pinHash = 'b2d8fed8a41d3b53d8845e706a875dfb7f0c693c728c60ae76837871143039b6';

const media: Array<{
  name: MediaName;
  describeTool: (config?: Record<string, unknown>) => BlockToolDescription;
  data: BlokSchema;
  sample: Record<string, unknown>;
}> = [
  {
    name: 'image',
    describeTool: describeImage,
    data: IMAGE_DATA,
    sample: {
      url: 'https://example.com/a.png',
      variants: [{ url: 'https://example.com/a.avif', mimeType: 'image/avif' }, { url: 'https://example.com/a.png', mimeType: 'image/png' }],
      caption: 'Cap < &',
      captionVisible: true,
      alt: 'Alt < &',
      fileName: 'a.png',
      width: 50,
      alignment: 'left',
      size: 'md',
      frame: 'border',
      rounded: true,
      naturalWidth: 800.5,
      naturalHeight: 600.5,
      crop: { x: 10, y: 10, w: 50, h: 50, shape: 'circle' },
      rotation: 90,
      flipX: true,
      straighten: 5,
      filter: 'my-host-look',
      filterStrength: 60,
      adjust: { brightness: 10, contrast: 20, saturation: 30 },
      markup: [
        { id: 'm1', type: 'pen', color: '#ff3b30', points: [0.1, 0.1, 0.5, 0.2, 0.2, 0.8], size: 0.012 },
        { id: 'm2', type: 'rect', color: '#0a84ff', x1: 0.1, y1: 0.1, x2: 0.5, y2: 0.5, size: 0.012, fill: true },
        { id: 'm3', type: 'text', color: '#ffffff', x: 0.5, y: 0.5, text: 'Hi', size: 0.06, style: 'outline', rotation: 15 },
      ],
    },
  },
  {
    name: 'video',
    describeTool: describeVideo,
    data: VIDEO_DATA,
    sample: {
      url: 'https://example.com/a.mp4',
      variants: [{ url: 'https://example.com/a.webm', mimeType: 'video/webm' }, { url: 'https://example.com/a.mp4', mimeType: 'video/mp4' }],
      caption: 'Cap < &',
      captionVisible: true,
      width: 50,
      alignment: 'left',
      autoplay: true,
      loop: true,
      hideControls: true,
      fileName: 'a.mp4',
      mimeType: 'video/mp4',
      aspectRatio: '16 / 9',
    },
  },
  {
    name: 'audio',
    describeTool: describeAudio,
    data: AUDIO_DATA,
    sample: {
      url: 'https://example.com/a.mp3',
      caption: 'Cap < &',
      captionVisible: true,
      title: 'Song < &',
      artist: 'Someone < &',
      coverUrl: '',
      loop: true,
      width: 50,
      alignment: 'left',
      fileName: 'a.mp3',
      mimeType: 'audio/mpeg',
      duration: 120,
      peaks: [0.1, 0.9],
    },
  },
  {
    name: 'file',
    describeTool: describeFile,
    data: FILE_DATA,
    sample: {
      url: 'https://example.com/a.pdf',
      fileName: 'a < &.pdf',
      size: 1024,
      mimeType: 'application/pdf',
      caption: 'Cap < &',
      captionVisible: true,
    },
  },
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const mediaTools: Array<{ name: MediaName; toolClass: unknown; summaryFields: string[] }> = [
  { name: 'image', toolClass: ImageTool, summaryFields: ['alignment', 'size', 'width'] },
  { name: 'video', toolClass: VideoTool, summaryFields: ['alignment', 'width', 'autoplay', 'loop'] },
  { name: 'audio', toolClass: AudioTool, summaryFields: ['title', 'artist', 'alignment'] },
  { name: 'file', toolClass: FileTool, summaryFields: ['fileName', 'mimeType'] },
];

const hasDescribe = (tool: unknown): tool is { describe: DescribeBlockTool } =>
  typeof tool === 'function' && 'describe' in tool && typeof tool.describe === 'function';

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('native media descriptions through public discovery', () => {
  it.each(mediaTools)('$name is available in the shared description registry', ({ name }) => {
    expect(typeof BUILT_IN_BLOCK_DESCRIPTIONS[name], name).toBe('function');
  });

  it.each(mediaTools)('$name exposes the registered schema and summary fields through its real class', ({ name, toolClass, summaryFields }) => {
    expect(hasDescribe(toolClass), name).toBe(true);

    if (!hasDescribe(toolClass)) {
      throw new Error(`${name} must expose describe.`);
    }

    const describeTool = BUILT_IN_BLOCK_DESCRIPTIONS[name];

    expect(typeof describeTool, name).toBe('function');

    if (describeTool === undefined) {
      throw new Error(`Missing description for ${name}.`);
    }

    const description = toolClass.describe({});

    expect(toolClass.describe).toBe(describeTool);
    expect(description.data).toEqual(blokDocumentSchema.$defs[name]);
    expect(description.summaryFields).toEqual(summaryFields);
  });

  it('the real image class rejects filter names outside its configured looks', () => {
    expect(hasDescribe(ImageTool)).toBe(true);

    if (!hasDescribe(ImageTool)) {
      throw new Error('Image must expose describe.');
    }

    const custom: ImageFilterDefinition = { name: 'brand', title: 'Brand', css: 'sepia(0.2)' };
    const { data } = ImageTool.describe({ filters: ['none', 'vivid', custom] });

    expect(validateAgainst(data, { url: 'u', filter: 'noir' }).length).toBeGreaterThan(0);
    expect(validateAgainst(data, { url: 'u', filter: 'none' }).length).toBeGreaterThan(0);
    expect(validateAgainst(data, { url: 'u', filter: 'brand' })).toEqual([]);
    expect(validateAgainst(data, { url: 'u', filter: 'vivid' })).toEqual([]);
    expect(validateAgainst(data, { url: 'u' })).toEqual([]);
  });

  it('the real image class forbids every explicit filter when filters is empty', () => {
    expect(hasDescribe(ImageTool)).toBe(true);

    if (!hasDescribe(ImageTool)) {
      throw new Error('Image must expose describe.');
    }

    const { data } = ImageTool.describe({ filters: [] });

    expect(validateAgainst(data, { url: 'u', filter: 'vivid' }).length).toBeGreaterThan(0);
    expect(validateAgainst(data, { url: 'u', filter: 'none' }).length).toBeGreaterThan(0);
    expect(validateAgainst(data, { url: 'u' })).toEqual([]);
  });
});

describe('media saved-schema preservation', () => {
  it('keeps the complete published byte pin without refreshing it', () => {
    const pinned = readFileSync(pinPath);

    expect(createHash('sha256').update(pinned).digest('hex')).toBe(pinHash);
    expect(JSON.stringify(blokDocumentSchema, null, 2)).toBe(pinned.toString('utf8'));
  });

  it.each(media)('$name retains the independently pinned schema and shared identity', ({ name, describeTool, data }) => {
    const published: unknown = JSON.parse(readFileSync(pinPath, 'utf8'));

    if (!isRecord(published) || !isRecord(published.$defs)) {
      throw new Error('Published schema must expose $defs.');
    }

    expect(data).toEqual(published.$defs[name]);
    expect(describeTool().data).toBe(data);
    expect(describeTool({}).data).toBe(data);
    expect(blokDocumentSchema.$defs[name]).toBe(data);
  });

  it.each(media)('$name produces a JSON-safe description', ({ describeTool }) => {
    const description = describeTool();
    const roundTrip: unknown = JSON.parse(JSON.stringify(description));

    expect(roundTrip).toEqual(description);
  });

  it.each(media)('$name accepts every currently published saved field', ({ describeTool, sample }) => {
    expect(validateAgainst(describeTool().data, sample)).toEqual([]);
  });

  it.each(media)('$name still requires the source URL', ({ describeTool }) => {
    expect(validateAgainst(describeTool().data, {}).length).toBeGreaterThan(0);
    expect(validateAgainst(describeTool().data, { url: '' })).toEqual([]);
  });

  it.each(media)('$name still rejects unknown saved fields', ({ describeTool }) => {
    expect(validateAgainst(describeTool().data, { url: 'u', unexpected: true }).length).toBeGreaterThan(0);
  });

  it.each(media)('$name keeps captions as strings, not rich-text segments', ({ describeTool }) => {
    expect(validateAgainst(describeTool().data, { url: 'u', caption: [{ text: 'Cap' }] }).length).toBeGreaterThan(0);
    expect(validateAgainst(describeTool().data, { url: 'u', caption: '<b>literal</b> & text' })).toEqual([]);
  });
});

const mediaConfigs: Array<{
  name: 'video' | 'audio' | 'file';
  describeTool: (config?: Record<string, unknown>) => BlockToolDescription;
  config: Record<string, unknown>;
  sample: Record<string, unknown>;
}> = [
  {
    name: 'video',
    describeTool: describeVideo,
    config: { sources: 'upload', types: ['video/webm'], maxSize: 1, glow: 'none', captionPlaceholder: 'Caption' },
    sample: { url: 'u', mimeType: 'video/mp4' },
  },
  {
    name: 'audio',
    describeTool: describeAudio,
    config: { sources: 'url', types: ['audio/ogg'], maxSize: 1, captionPlaceholder: 'Caption' },
    sample: { url: 'u', mimeType: 'audio/mpeg', coverUrl: '' },
  },
  {
    name: 'file',
    describeTool: describeFile,
    config: { sources: 'upload', types: ['text/plain'], maxSize: 1, endpoints: '/upload', field: 'attachment', captionPlaceholder: 'Caption' },
    sample: { url: 'u', mimeType: 'application/pdf' },
  },
];

describe('media config is not a new saved-data validator policy', () => {
  it.each(mediaConfigs)('$name upload and presentation config does not narrow saved data', ({ describeTool, config, sample }) => {
    expect(describeTool(config)).toEqual(describeTool());
    expect(validateAgainst(describeTool(config).data, sample)).toEqual([]);
  });

  it('image config other than filters leaves its published data open', () => {
    const config = {
      sources: 'upload',
      types: ['image/avif'],
      maxSize: 1,
      compress: false,
      convertGifToVideo: false,
      reloadAttempts: 0,
      captionPlaceholder: 'Caption',
    };

    expect(describeImage(config)).toEqual(describeImage());
    expect(validateAgainst(describeImage(config).data, { url: 'u', filter: 'my-host-look' })).toEqual([]);
  });
});

const nonArrayConfigs: Array<{ label: string; config: Record<string, unknown> }> = [
  { label: 'undefined', config: { filters: undefined } },
  { label: 'null', config: { filters: null } },
  { label: 'a string', config: { filters: 'vivid' } },
  { label: 'an object', config: { filters: { name: 'vivid' } } },
  { label: 'a number', config: { filters: 1 } },
  { label: 'a boolean', config: { filters: true } },
];

const emptyFilterConfigs: Array<{ label: string; config: Record<string, unknown> }> = [
  { label: 'an empty array', config: { filters: [] } },
  { label: 'only Original entries', config: { filters: ['none', { name: 'none' }] } },
  { label: 'only malformed entries', config: { filters: [null, undefined, false, 42, {}, [], { name: 1 }, { name: '' }, ''] } },
];

describe('image filter config narrowing', () => {
  it('narrows only filter, preserving configured names and their order without Original', () => {
    const custom: ImageFilterDefinition = { name: 'brand', title: 'Brand', css: 'sepia(0.2)' };
    const { data } = describeImage({ filters: ['none', 'noir', custom, 'vivid'] });

    expect(validateAgainst(data, { url: 'u', filter: 'warm' }).length).toBeGreaterThan(0);
    expect(validateAgainst(data, { url: 'u', filter: 'none' }).length).toBeGreaterThan(0);
    expect(data).toEqual({
      ...IMAGE_DATA,
      properties: { ...IMAGE_DATA.properties, filter: { type: 'string', enum: ['noir', 'brand', 'vivid'] } },
    });

    for (const filter of ['noir', 'brand', 'vivid']) {
      expect(validateAgainst(data, { url: 'u', filter })).toEqual([]);
    }

    expect(validateAgainst(data, { url: 'u' })).toEqual([]);
    expect(describeImage({ filters: ['none', 'noir', custom, 'vivid'] }).guardedFields).toEqual({ markup: 'image.*Markup' });
  });

  it('ignores malformed entries without coercing names or deduplicating the remaining order', () => {
    const { data } = describeImage({
      filters: [
        null, undefined, false, 42, {}, [], { name: null }, { name: 42 }, { name: '' },
        { name: 'none' }, '', 'none', 'vivid',
        { name: 'brand', title: 'Brand', css: 'sepia(0.2)' },
        'vivid', { name: 'name-only' },
      ],
    });

    expect(validateAgainst(data, { url: 'u', filter: '42' }).length).toBeGreaterThan(0);
    expect(data).toEqual({
      ...IMAGE_DATA,
      properties: { ...IMAGE_DATA.properties, filter: { type: 'string', enum: ['vivid', 'brand', 'vivid', 'name-only'] } },
    });
    expect(validateAgainst(data, { url: 'u', filter: 'name-only' })).toEqual([]);
  });

  it.each(emptyFilterConfigs)('$label forbids assigning a filter but still permits omission', ({ config }) => {
    const { data } = describeImage(config);

    expect(validateAgainst(data, { url: 'u', filter: 'vivid' }).length).toBeGreaterThan(0);
    expect(validateAgainst(data, { url: 'u', filter: 'none' }).length).toBeGreaterThan(0);
    expect(validateAgainst(data, { url: 'u', filter: '' }).length).toBeGreaterThan(0);
    expect(data).toEqual({
      ...IMAGE_DATA,
      properties: { ...IMAGE_DATA.properties, filter: { type: 'string', enum: [] } },
    });
    expect(validateAgainst(data, { url: 'u' })).toEqual([]);
  });

  it.each(nonArrayConfigs)('filters as $label leaves the published schema open', ({ config }) => {
    const description = describeImage(config);

    expect(validateAgainst(description.data, { url: 'u', filter: 'my-host-look' })).toEqual([]);
    expect(validateAgainst(description.data, { url: 'u', filter: '' }).length).toBeGreaterThan(0);
    expect(description.data).toBe(IMAGE_DATA);
  });

  it('does not mutate config or the unrestricted schema while narrowing', () => {
    const custom = Object.freeze({ name: 'brand', title: 'Brand', css: 'sepia(0.2)' });
    const filters = Object.freeze(['none', 'vivid', custom]);
    const config = Object.freeze({ filters });
    const configBefore = JSON.stringify(config);
    const dataBefore = JSON.stringify(IMAGE_DATA);

    describeImage(config);

    expect(JSON.stringify(config)).toBe(configBefore);
    expect(JSON.stringify(IMAGE_DATA)).toBe(dataBefore);
    expect(describeImage().data).toBe(IMAGE_DATA);
    expect(validateAgainst(describeImage().data, { url: 'u', filter: 'another-host-look' })).toEqual([]);
  });
});

describe('media agent guidance', () => {
  it('image guards markup and directs coupled edits to their actions', () => {
    const description = describeImage();

    expect(description.guardedFields).toEqual({ markup: 'image.*Markup' });
    expect(description.summaryFields).toEqual(['alignment', 'size', 'width']);

    for (const action of [
      'image.setSource', 'image.crop', 'image.rotate', 'image.flip', 'image.straighten',
      'image.addMarkup', 'image.updateMarkup', 'image.removeMarkup',
    ]) {
      expect(description.guidance).toContain(action);
    }

    expect(description.guidance).toContain('crop and markup');
    expect(description.guidance).toContain('caption and alt are plain text');
  });

  it('video directs source changes to its action and summarizes playback', () => {
    const description = describeVideo();

    expect(description.guidance).toContain('video.setSource');
    expect(description.guidance).toContain('caption is plain text');
    expect(description.summaryFields).toEqual(['alignment', 'width', 'autoplay', 'loop']);
  });

  it('audio directs source and cover changes to actions and permits a blank cover', () => {
    const description = describeAudio();

    expect(description.guidance).toContain('audio.setSource');
    expect(description.guidance).toContain('audio.setCover');
    expect(description.guidance).toContain('coverUrl as ""');
    expect(description.guidance).toContain('caption, title and artist are plain text');
    expect(description.summaryFields).toEqual(['title', 'artist', 'alignment']);
    expect(validateAgainst(description.data, { url: 'u', coverUrl: '' })).toEqual([]);
  });

  it('file directs source changes to its action and summarizes file identity', () => {
    const description = describeFile();

    expect(description.guidance).toContain('file.setSource');
    expect(description.guidance).toContain('fileName and caption are plain text');
    expect(description.summaryFields).toEqual(['fileName', 'mimeType']);
  });
});
