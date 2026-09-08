import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  buildMentionElement,
  MENTION_LABEL_CLASS,
} from '../../../../../src/tools/link/mention/mention';

/**
 * Mutation coverage for the mention chip builder.
 *
 * Every recorded mutant here lives on an EMPTY-STRING edge:
 *
 * - `title.length > 0` and `favicon.length > 0` only differ from `true` /
 *   `>= 0` when the string is present but empty, so the discriminating input
 *   is `''` — not a missing key.
 * - The `catch` around `new URL(...)` needs a url that actually throws. With
 *   the catch body emptied, `resolveLabel` returns `undefined` and the label
 *   reads the literal text `undefined`, which the raw-url assertion rejects.
 * - `favicon.alt = ''` is read back with `getAttribute`, since an `alt` of
 *   any value keeps the attribute present.
 *
 * All six recorded mutants are killable; no equivalent mutants in this file.
 */
describe('buildMentionElement mutants', () => {
  const labelTextOf = (anchor: HTMLAnchorElement): string => {
    const label = anchor.querySelector<HTMLSpanElement>(`span.${MENTION_LABEL_CLASS}`);

    if (label === null) {
      throw new Error('mention chip produced no label span');
    }

    return label.textContent ?? '';
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('falls back to the hostname when the title is present but empty', () => {
    const anchor = buildMentionElement({ url: 'https://example.com/deep/path',
      title: '' });

    expect(labelTextOf(anchor)).toBe('example.com');
  });

  it('still prefers a one-character title over the hostname', () => {
    const anchor = buildMentionElement({ url: 'https://example.com/deep/path',
      title: 'x' });

    expect(labelTextOf(anchor)).toBe('x');
  });

  it('falls back to the raw url when it cannot be parsed', () => {
    const anchor = buildMentionElement({ url: 'not a url' });

    expect(labelTextOf(anchor)).toBe('not a url');
  });

  it('renders no favicon when the favicon is present but empty', () => {
    const anchor = buildMentionElement({ url: 'https://example.com',
      title: 'Example',
      favicon: '' });

    expect(anchor.querySelector('img')).toBeNull();
  });

  it('renders a favicon for a one-character favicon url', () => {
    const anchor = buildMentionElement({ url: 'https://example.com',
      title: 'Example',
      favicon: 'f' });

    expect(anchor.querySelector('img')).not.toBeNull();
  });

  it('gives the favicon an empty alt so it stays decorative', () => {
    const anchor = buildMentionElement({ url: 'https://example.com',
      title: 'Example',
      favicon: 'https://example.com/favicon.ico' });
    const favicon = anchor.querySelector('img');

    if (favicon === null) {
      throw new Error('mention chip produced no favicon image');
    }

    expect(favicon.getAttribute('alt')).toBe('');
  });
});
