import { describe, it, expect } from 'vitest';
import * as Icons from '../../../../src/components/icons';

const icon = (name: string): string => {
  const value = (Icons as Record<string, unknown>)[name];

  if (typeof value !== 'string') {
    throw new Error(`${name} is not an icon string`);
  }

  return value;
};

const PANEL = '<rect x="3" y="4.5" width="14" height="11" rx="2.5"';
const SQUARE = '<rect x="3.5" y="3.5" width="13" height="13" rx="2.5"';
const PAGE = '<rect x="4.5" y="3" width="11" height="14" rx="2"';
const CIRCLE = '<circle cx="10" cy="10" r="7"';
const FILE_FOLD = 'M11 3v2.5a2 2 0 0 0 2 2h2.5';

describe('Keyline: every icon sits on the same few frames', () => {
  it.each(['IconTable', 'IconHeaderRow', 'IconImage', 'IconCallout', 'IconCalendar'])('%s uses the landscape panel', (name) => {
    expect(icon(name)).toContain(PANEL);
  });

  it.each(['IconInfo', 'IconHelp', 'IconClock'])('%s uses the keyline circle', (name) => {
    expect(icon(name)).toContain(CIRCLE);
  });

  it('Checkbox uses the keyline square', () => {
    expect(icon('IconCheckbox')).toContain(SQUARE);
  });

  it('a Blok page has no fold, a file on disk does', () => {
    expect(icon('IconPage')).toContain(PAGE);
    expect(icon('IconPage')).not.toContain(FILE_FOLD);

    for (const name of ['IconFile', 'IconFileDoc', 'IconFileSheet', 'IconFileSlides', 'IconFileArchive']) {
      expect(icon(name)).toContain(FILE_FOLD);
    }
  });

  it('the column picker draws on the landscape panel', () => {
    expect(Icons.buildIconColumnsCount(3)).toContain(PANEL);
  });
});

describe('Keyline: the icons the user refined in the lab', () => {
  it('Quote is two tapered marks, each one filled shape with no stroke', () => {
    const quote = icon('IconQuote');
    const paths = quote.match(/<path\b[^>]*>/g) ?? [];

    expect(paths).toHaveLength(2);
    for (const path of paths) {
      expect(path).toContain('fill="currentColor"');
      expect(path).not.toContain('stroke=');
    }
  });

  it('FanDeck keeps the dot on its front swatch', () => {
    expect(icon('IconFanDeck')).toMatch(/<circle cx="5.75" cy="14.75" r="0.85" fill="currentColor"/);
  });

  it('Image hills end on the straight edges of the frame', () => {
    expect(icon('IconImage')).toContain('M3 12.5l4-4 7 7M11.25 12.75 14 10l3 3');
  });

  it('Caption is a short photo with the Image hills and a rule under it', () => {
    const caption = icon('IconCaption');

    expect(caption).toContain('<rect x="3" y="3" width="14" height="9" rx="2.5"');
    expect(caption).toContain('M3 15.5h9');
  });

  it('Toggle list has two rows, so it never reads as Bulleted list', () => {
    expect(icon('IconToggleList')).toContain('M10 6.5h6.5M10 13.5h6.5');
  });
});

describe('Keyline: the emoji category row keeps its heavier stroke', () => {
  const nav = Object.keys(Icons).filter((name) => name.startsWith('IconEmojiNav'));

  it.each(nav)('%s strokes at 1.5', (name) => {
    expect(icon(name)).not.toContain('stroke-width="1.25"');
  });
});
