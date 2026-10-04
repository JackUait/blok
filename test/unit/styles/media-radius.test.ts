/**
 * Media radii follow the radius design system
 * (docs/plans/2026-09-30-radius-design-system.md): role tokens, and children
 * near a rounded corner read the --blok-radius-inner their container publishes.
 * jsdom has no CSS, so this reads the source.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../../../src');
const read = (path: string): string => readFileSync(resolve(root, path), 'utf-8');

const MEDIA_FILES = [
  'styles/image.css',
  'styles/video.css',
  'styles/audio.css',
  'styles/embed.css',
  'styles/bookmark.css',
  'styles/file.css',
  'styles/media-empty.css',
  'tools/image/darkroom/darkroom.css',
  'tools/image/alt-popover.css',
];

/** selector → every declaration block written for exactly that selector. */
const rules = (css: string): Map<string, string[]> => {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const map = new Map<string, string[]>();
  const pattern = /([^{}]+)\{([^{}]*)\}/g;

  for (const match of source.matchAll(pattern)) {
    for (const selector of match[1].split(/,(?![^(]*\))/)) {
      const key = selector.trim().replace(/\s+/g, ' ');
      const list = map.get(key) ?? [];

      list.push(match[2]);
      map.set(key, list);
    }
  }

  return map;
};

const declared = (css: Map<string, string[]>, selector: string, property: string): string | null => {
  const escaped = property.replace(/[-]/g, '\\-');

  for (const body of css.get(selector) ?? []) {
    const match = body.match(new RegExp(`(?:^|;|\\s)${escaped}:\\s*([^;]+);`));

    if (match !== null) return match[1].trim().replace(/\s+/g, ' ');
  }

  return null;
};

const role = (name: string): string => `var(--blok-radius-${name})`;
const nested = (name: string): string => `var(--blok-radius-inner, var(--blok-radius-${name}))`;
const inner = (outer: string, ...gaps: string[]): string =>
  `max(var(--blok-radius-floor), calc(var(--blok-radius-${outer}) - ${gaps.map((gap) => `var(${gap})`).join(' - ')}))`;
const BORDER = '--blok-border-width-hairline';

const RADII: Array<[string, string, string]> = [
  ['styles/image.css', '[data-blok-tool="image"] .blok-image-inner img', role('block')],
  ['styles/image.css', '[data-blok-element-content].bg-selection:has([data-blok-tool="image"]) .blok-image-inner', role('block')],
  ['styles/image.css', '[data-blok-tool="image"] .blok-image-alt-pill', role('control')],
  ['styles/main.css', '[data-blok-tool="image"] .blok-image-toolbar', role('surface')],
  ['styles/image.css', '[data-blok-tool="image"] .blok-image-toolbar button', nested('control')],
  ['styles/image.css', '[data-blok-tool="image"] [data-role="image-selection-ring"]', 'calc(var(--blok-radius-block) + var(--blok-image-ring-gap))'],
  ['styles/image.css', '[data-blok-tool="image"][data-rounded="off"] [data-role="image-selection-ring"]', '0'],
  ['styles/image.css', '[data-blok-tool="image"] [data-role="image-resize-readout"]', role('control')],
  ['styles/image.css', '[data-blok-tool="image"] .blok-image-crop', role('block')],
  ['styles/image.css', '[data-blok-tool="image"][data-rounded="off"] .blok-image-crop', '0'],
  ['styles/image.css', '[data-blok-tool="image"] .blok-image-crop[data-shape="circle"]', '50%'],
  ['styles/image.css', '[data-blok-tool="image"] .blok-image-crop[data-shape="ellipse"]', '50%'],
  ['styles/image.css', '.blok-image-lightbox__crop[data-shape="circle"]', '50%'],
  ['styles/image.css', '.blok-image-lightbox__crop[data-shape="ellipse"]', '50%'],
  ['styles/file.css', '[data-blok-tool="file"] [data-role="file-card"]', 'inherit'],
  ['styles/image.css', '.blok-image-uploading__card', role('block')],
  ['styles/image.css', '.blok-image-uploading__cancel', nested('control')],
  ['styles/image.css', ':where(:root:not([data-blok-modality="pointer"])) .blok-image-uploading__cancel:focus-visible', nested('control')],
  ['styles/image.css', '.blok-image-uploading__tile', role('control-lg')],
  ['styles/image.css', '.blok-image-uploading__bar', role('pill')],
  ['styles/image.css', '.blok-image-error', role('block')],
  ['styles/image.css', '.blok-image-error__icon', role('control-lg')],
  ['styles/image.css', '.blok-image-error__btn', role('control')],
  ['styles/image.css', '[data-blok-tool="image"] .blok-image-inner[data-loading="true"]', role('block')],
  ['styles/main.css', '[data-blok-tool="image"] .blok-image-toolbar__align-popover', role('surface')],
  ['styles/main.css', '.blok-image-lightbox__bar', role('surface')],
  ['styles/main.css', '.blok-image-lightbox__nav', role('surface')],
  ['styles/main.css', '.blok-image-lightbox__btn', nested('control')],
  ['tools/image/alt-popover.css', '.blok-image-alt-popover', role('surface')],
  ['tools/image/darkroom/darkroom.css', '.blok-darkroom__btn', role('pill')],
  ['tools/image/darkroom/darkroom.css', '.blok-darkroom__pill', role('pill')],
  ['tools/image/darkroom/darkroom.css', '.blok-darkroom__chip', role('pill')],
  ['tools/image/darkroom/darkroom.css', '.blok-darkroom__handle--edge::before', role('pill')],
  // The frame and the fly-out clone morph between 0 and 50% through one channel.
  ['tools/image/darkroom/darkroom.css', '.blok-darkroom__frame', 'var(--blok-radius-darkroom-frame)'],
  ['tools/image/darkroom/darkroom.css', '.blok-darkroom__grid', 'var(--blok-radius-darkroom-frame)'],
  ['tools/image/darkroom/darkroom.css', '.blok-darkroom-flight', 'var(--blok-radius-darkroom-frame)'],
  ['styles/video.css', '[data-blok-tool="video"] .blok-video-media', role('block')],
  ['styles/video.css', '[data-blok-element-content].bg-selection:has([data-blok-tool="video"]) .blok-video-inner', role('block')],
  ['styles/video.css', '[data-blok-tool="video"] .blok-video-error-state', role('block')],
  ['styles/video.css', '[data-blok-tool="video"] .blok-video-retry', role('control')],
  ['styles/video.css', '[data-blok-tool="video"] .blok-video-controls__menu', role('surface')],
  ['styles/video.css', '[data-blok-tool="video"] .blok-video-controls__menu-row', nested('control')],
  ['styles/video.css', '[data-blok-tool="video"] .blok-video-controls__speed-chips', nested('control')],
  ['styles/video.css', '[data-blok-tool="video"] .blok-video-controls__speed-chip', nested('control')],
  ['styles/video.css', '[data-blok-tool="video"] .blok-video-controls__switch', role('pill')],
  ['styles/video.css', '[data-blok-tool="video"] .blok-video-controls__seek-tooltip', role('control')],
  ['styles/video.css', '[data-blok-tool="video"] .blok-video-controls__seek-thumb', nested('control-sm')],
  ['styles/video.css', '[data-blok-tool="video"] .blok-video-inner[data-theater="true"] .blok-video-media video', role('block')],
  ['styles/video.css', '[data-blok-tool="video"] .blok-video-controls__ctx', role('surface')],
  ['styles/video.css', '[data-blok-tool="video"] .blok-video-controls__ctx-item', nested('control')],
  ['styles/video.css', '[data-blok-tool="video"] .blok-video-controls__stats', role('surface')],
  ['styles/video.css', '[data-blok-tool="video"] .blok-video-converting', role('control-sm')],
  ['styles/audio.css', '[data-blok-tool="audio"] .blok-audio-inner', role('block')],
  ['styles/audio.css', '[data-blok-tool="audio"] .blok-audio-cover', role('block')],
  ['styles/audio.css', '.blok-audio-cover-picker', role('surface')],
  ['styles/audio.css', '.blok-audio-cover-picker .blok-media-empty__card', nested('block')],
  ['styles/audio.css', '[data-blok-tool="audio"] .blok-audio-controls__speed-menu', role('surface')],
  ['styles/audio.css', '[data-blok-tool="audio"] .blok-audio-controls__speed-step', nested('control')],
  ['styles/audio.css', '[data-blok-tool="audio"] .blok-audio-controls__speed-chip', nested('control')],
  ['styles/audio.css', '[data-blok-tool="audio"] .blok-audio-error-state', role('block')],
  ['styles/audio.css', '[data-blok-tool="audio"] .blok-audio-retry', role('control')],
  ['styles/embed.css', '[data-blok-tool="embed"] [data-role="embed-aspect"]', role('block')],
  ['styles/embed.css', '[data-blok-tool="embed"] .blok-embed-toolbar', role('surface')],
  ['styles/embed.css', '[data-blok-tool="embed"] .blok-embed-toolbar button', nested('control')],
  ['styles/embed.css', '[data-blok-tool="embed"] .blok-embed-toolbar__align-popover', role('surface')],
  ['styles/embed.css', '.blok-embed-empty__submit', role('control-sm')],
  ['styles/embed.css', '.blok-embed-empty__kbd', role('control-sm')],
  ['styles/embed.css', '.blok-embed-empty__readonly', role('block')],
  ['styles/embed.css', '.blok-embed-linkcard', role('block')],
  ['styles/embed.css', '.blok-embed-linkcard__action', nested('control')],
  ['styles/bookmark.css', '[data-blok-tool="bookmark"] .blok-bookmark', role('block')],
  ['styles/bookmark.css', '[data-blok-tool="bookmark"] .blok-bookmark__placeholder', role('block')],
  ['styles/file.css', '[data-blok-tool="file"] .blok-file-card', role('block')],
  ['styles/file.css', '[data-blok-tool="file"] .blok-file-icon', role('control-lg')],
  ['styles/file.css', '[data-blok-tool="file"] .blok-file-uploading', role('block')],
  ['styles/file.css', '[data-blok-tool="file"] .blok-file-cancel', role('control')],
  ['styles/file.css', '[data-blok-tool="file"] .blok-file-error-state', role('block')],
  ['styles/file.css', '[data-blok-tool="file"] .blok-file-retry', role('control')],
  ['styles/file.css', '.blok-file-preview', role('dialog')],
  ['styles/file.css', '.blok-file-preview-pre::-webkit-scrollbar-thumb', role('control-sm')],
  ['styles/file.css', '.blok-file-preview-md code', role('mark')],
  ['styles/file.css', '.blok-file-preview-md pre', role('block')],
  ['styles/file.css', '.blok-file-preview-md img', role('block')],
  ['styles/file.css', '.blok-md-alert', role('block')],
  ['styles/file.css', '.blok-file-preview-docx .blok-docx', role('surface')],
  ['styles/file.css', '.blok-file-preview-xlsx-table', role('surface')],
  ['styles/file.css', '.blok-file-preview-pptx > *', role('surface')],
  ['styles/media-empty.css', '.blok-media-empty__card', role('block')],
  ['styles/media-empty.css', '.blok-media-empty__tab', nested('control')],
  ['styles/media-empty.css', '.blok-media-empty__panel', nested('block')],
  ['styles/media-empty.css', '.blok-media-empty__tile', role('control-lg')],
  ['styles/media-empty.css', '.blok-media-empty__glyph', role('control-lg')],
  ['styles/media-empty.css', '.blok-media-empty__choose', role('control')],
  ['styles/media-empty.css', '.blok-media-empty__embed-icon[data-site] .blok-media-empty__embed-site', role('control-sm')],
  ['styles/media-empty.css', '.blok-media-empty__embed-submit', role('control-sm')],
  ['styles/media-empty.css', '.blok-media-empty__embed-bar--large .blok-media-empty__embed-submit', nested('control-lg')],
  ['styles/media-empty.css', '.blok-media-empty__embed-kbd', role('control-sm')],
  ['styles/media-empty.css', '.blok-media-empty__embed-type', role('control-sm')],
  ['styles/media-empty.css', '.blok-media-empty__input', role('field')],
  ['styles/media-empty.css', '.blok-media-empty__search', role('field')],
  ['styles/media-empty.css', '.blok-media-empty__submit', role('control')],
  ['styles/media-empty.css', '.blok-media-empty__badge', role('control-sm')],
  ['styles/media-empty.css', '.blok-media-empty__drop-inner', role('control')],
];

/** Containers publish --blok-radius-inner from their own role, border and padding tokens. */
const INNER: Array<[string, string, string]> = [
  ['styles/main.css', '[data-blok-tool="image"] .blok-image-toolbar', inner('surface', '--blok-space-0-75')],
  ['styles/image.css', '.blok-image-uploading__header', inner('block', BORDER, '--blok-space-2')],
  ['styles/main.css', '[data-blok-tool="image"] .blok-image-toolbar__align-popover', inner('surface', '--blok-space-1')],
  ['styles/main.css', '.blok-image-lightbox__bar', inner('surface', '--blok-space-1-5')],
  ['styles/main.css', '.blok-image-lightbox__nav', inner('surface', '--blok-space-1-5')],
  ['styles/video.css', '[data-blok-tool="video"] .blok-video-controls__menu', inner('surface', BORDER, '--blok-space-1-5')],
  // The preset bar sits on the card's padding edge, so its chips nest one more ring in.
  ['styles/video.css', '[data-blok-tool="video"] .blok-video-controls__speed-chips', inner('surface', BORDER, '--blok-space-1-5', '--blok-space-0-5')],
  ['styles/video.css', '[data-blok-tool="video"] .blok-video-controls__seek-tooltip', inner('control', '--blok-space-1')],
  ['styles/video.css', '[data-blok-tool="video"] .blok-video-controls__ctx', inner('surface', '--blok-space-1-5')],
  ['styles/audio.css', '.blok-audio-cover-picker', inner('surface', BORDER, '--blok-space-2')],
  ['styles/audio.css', '[data-blok-tool="audio"] .blok-audio-controls__speed-menu', inner('surface', BORDER, '--blok-space-2')],
  ['styles/embed.css', '[data-blok-tool="embed"] .blok-embed-toolbar', inner('surface', '--blok-space-1')],
  ['styles/embed.css', '[data-blok-tool="embed"] .blok-embed-toolbar__align-popover', inner('surface', '--blok-space-1')],
  ['styles/embed.css', '.blok-embed-linkcard__actions', inner('block', BORDER, '--blok-space-1')],
  ['styles/media-empty.css', '.blok-media-empty__card > *', inner('block', BORDER, '--blok-space-2')],
  ['styles/media-empty.css', '[data-blok-field].blok-media-empty__embed-bar--large', inner('field', BORDER, '--blok-space-1-5')],
];

const parsed = new Map<string, Map<string, string[]>>();
const cssOf = (file: string): Map<string, string[]> => {
  const cached = parsed.get(file);

  if (cached !== undefined) return cached;
  const fresh = rules(read(file));

  parsed.set(file, fresh);

  return fresh;
};

describe('media radii use role tokens', () => {
  it.each(RADII)('%s  %s', (file, selector, expected) => {
    expect(declared(cssOf(file), selector, 'border-radius')).toBe(expected);
  });
});

describe('media containers publish the nested radius', () => {
  it.each(INNER)('%s  %s', (file, selector, expected) => {
    expect(declared(cssOf(file), selector, '--blok-radius-inner')).toBe(expected);
  });
});

describe('media files hold no off-system radius', () => {
  const OLD = /--blok-radius-(?:xs|sm|md|lg|xl|md-plus|hairline|none)\b/;

  it.each(MEDIA_FILES)('%s', (file) => {
    const source = read(file).replace(/\/\*[\s\S]*?\*\//g, '');
    const radii = [...source.matchAll(/border(?:-[a-z]+)*-radius:\s*([^;]+);/g)].map((m) => m[1].trim());

    expect(source).not.toMatch(OLD);
    for (const value of radii) {
      expect(value, value).not.toMatch(/--blok-space-|--blok-border-width-|--radius-|\d+px/);
    }
  });

  it.each(['tools/image/ui.ts', 'tools/file/ui.ts'])('%s sets no inline radius', (file) => {
    expect(read(file)).not.toMatch(/borderRadius/);
  });

  it('no dead image popover, toolbar pill or audio radius CSS is left', () => {
    expect(read('styles/image.css')).not.toMatch(/blok-image-popover|blok-image-toolbar__pill/);
    expect(read('styles/audio.css')).not.toContain('--blok-audio-radius');
  });
});
