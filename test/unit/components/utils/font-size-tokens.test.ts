/**
 * `style.fontSize` config → `--blok-*-font-size` custom properties.
 *
 * Every text-bearing block exposes its own font-size scenario, so a host can
 * retype one block (or one scenario inside a block — a caption, a comfortable
 * table, a large quote) from the constructor config instead of hand-writing a
 * stylesheet that has to know Blok's internal class names.
 */
import { describe, expect, it } from 'vitest';

import { buildFontSizeVarLines } from '../../../../src/components/utils/font-size-tokens';

describe('buildFontSizeVarLines', () => {
  it('returns no lines when nothing is configured', () => {
    expect(buildFontSizeVarLines(undefined)).toEqual([]);
    expect(buildFontSizeVarLines({})).toEqual([]);
  });

  it('maps single-scenario blocks to their token', () => {
    expect(buildFontSizeVarLines({ paragraph: '17px' })).toEqual([
      '--blok-paragraph-font-size: 17px;',
    ]);
    expect(buildFontSizeVarLines({ callout: '15px' })).toEqual([
      '--blok-callout-font-size: 15px;',
    ]);
    expect(buildFontSizeVarLines({ code: '13px' })).toEqual([
      '--blok-code-font-size: 13px;',
    ]);
    expect(buildFontSizeVarLines({ toggle: '17px' })).toEqual([
      '--blok-toggle-font-size: 17px;',
    ]);
  });

  it('maps headings onto the pre-existing per-level tokens', () => {
    expect(buildFontSizeVarLines({ heading: { 1: '32px', 6: '13px' } })).toEqual([
      '--blok-heading-1-font-size: 32px;',
      '--blok-heading-6-font-size: 13px;',
    ]);
  });

  it('maps every per-block scenario', () => {
    expect(
      buildFontSizeVarLines({
        list: { item: '17px', checklist: '16px' },
        quote: { default: '17px', large: '1.4em' },
        table: { compact: '13px', comfortable: '17px' },
        image: { caption: '12px' },
        video: { caption: '13px' },
        audio: { caption: '13px' },
        file: { caption: '13px' },
        embed: { caption: '0.9em' },
        bookmark: { title: '15px', description: '13px', link: '13px' },
      })
    ).toEqual([
      '--blok-list-font-size: 17px;',
      '--blok-checklist-font-size: 16px;',
      '--blok-quote-font-size: 17px;',
      '--blok-quote-large-font-size: 1.4em;',
      '--blok-table-font-size: 13px;',
      '--blok-table-comfortable-font-size: 17px;',
      '--blok-image-caption-font-size: 12px;',
      '--blok-video-caption-font-size: 13px;',
      '--blok-audio-caption-font-size: 13px;',
      '--blok-file-caption-font-size: 13px;',
      '--blok-embed-caption-font-size: 0.9em;',
      '--blok-bookmark-title-font-size: 15px;',
      '--blok-bookmark-description-font-size: 13px;',
      '--blok-bookmark-link-font-size: 13px;',
    ]);
  });

  it('skips empty values so a blank string cannot emit an invalid declaration', () => {
    expect(buildFontSizeVarLines({ paragraph: '', quote: { large: '  ' } })).toEqual([]);
  });

  it('emits lines in a stable, spec-declared order regardless of key order', () => {
    const a = buildFontSizeVarLines({ code: '13px', paragraph: '17px' });
    const b = buildFontSizeVarLines({ paragraph: '17px', code: '13px' });

    expect(a).toEqual(b);
  });
});
