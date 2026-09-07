import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ANONYMOUS_GLYPHS, UNKNOWN_GLYPH } from '../../../src/components/modules/collaboration/anonymous-identity';
import { PRESENCE_GLYPH_GROUP, decodePresenceGlyphs } from '../../../src/playground/presence-glyph-icons';

const html = readFileSync(resolve(__dirname, '../../../index.html'), 'utf-8');
// Read, never imported: vitest answers every query on a .css id — `?raw`
// included — with an empty module.
const presenceCss = readFileSync(resolve(__dirname, '../../../src/styles/presence.css'), 'utf-8');

const section = (start: string, end: string): string => {
  const from = html.indexOf(start);
  const to = html.indexOf(end, from);

  if (from < 0 || to < 0) {
    throw new Error(`Missing playground section: ${start}`);
  }

  return html.slice(from, to);
};

const SLOT_ORDER = [...ANONYMOUS_GLYPHS, UNKNOWN_GLYPH];
const glyphs = decodePresenceGlyphs(presenceCss);

describe('presence glyph icons', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('decodes every silhouette the anonymous slot pass can hand out, in slot order', () => {
    expect(Object.keys(glyphs)).toStrictEqual(SLOT_ORDER);
  });

  it.each(SLOT_ORDER)('turns %s into recolourable 20-pixel markup', (glyph) => {
    const svg = new DOMParser().parseFromString(glyphs[glyph], 'text/html').querySelector('svg');

    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('viewBox')).toBe('0 0 20 20');
    expect(svg?.getAttribute('width')).toBe('20');
    expect(svg?.getAttribute('height')).toBe('20');
    // The lightbox recolours by setting `color`, so a hard-coded fill is dead.
    expect(glyphs[glyph]).toContain('currentColor');
    expect(glyphs[glyph]).not.toContain('%3C');
  });

  it('keeps a glyph the slot list does not know rather than hiding it', () => {
    const extra = decodePresenceGlyphs(`${presenceCss}
[data-blok-presence-glyph="nebula"] {
  --blok-presence-glyph: url("data:image/svg+xml,%3Csvg%3E%3C/svg%3E");
}`);

    expect(Object.keys(extra)).toStrictEqual([...SLOT_ORDER, 'nebula']);
  });
});

describe('playground icon gallery wiring', () => {
  const GLYPH_STUB = { astronaut: '<svg data-glyph="astronaut"></svg>' };

  const renderGallery = (): { iconGroups: Record<string, string[]>; icons: Record<string, string> } => {
    const captured: { args: { iconGroups: Record<string, string[]>; icons: Record<string, string> } | null } = { args: null };

    runInNewContext(section('const iconGroups = {', '/**'), {
      document: { getElementById: (): unknown => ({}) },
      Icons: { IconCheck: '<svg data-icon="check"></svg>' },
      PRESENCE_GLYPH_GROUP,
      PRESENCE_GLYPH_ICONS: GLYPH_STUB,
      renderIconGallery: (args: { iconGroups: Record<string, string[]>; icons: Record<string, string> }): void => {
        captured.args = args;
      },
    });

    if (captured.args === null) {
      throw new Error('The playground never rendered the icon gallery');
    }

    // The VM builds its arrays in another realm, where toStrictEqual sees a
    // foreign Array prototype and fails on identical values.
    return structuredClone(captured.args);
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('groups the anonymous silhouettes on the icons tab', () => {
    expect(renderGallery().iconGroups[PRESENCE_GLYPH_GROUP]).toStrictEqual(Object.keys(GLYPH_STUB));
  });

  it('hands the gallery the silhouette markup alongside the exported icons', () => {
    const { icons } = renderGallery();

    expect(icons.astronaut).toBe(GLYPH_STUB.astronaut);
    expect(icons.IconCheck).toContain('data-icon="check"');
  });
});
