// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Core } from '../../../../src/components/core';
import { Paragraph } from '../../../../src/tools/paragraph';
import type { OutputBlockData } from '../../../../types';

/** A host inline tool on a tag the paragraph already allows for its own reasons (equations use span). */
class ClassedSpan {
  public static isInline = true;
  public static title = 'Spark';
  public static sanitize = { span: { class: 'cdx-x' } };
  public render(): HTMLElement {
    return document.createElement('button');
  }
}

/** An Editor.js-era marker: its marks are `<mark class="cdx-marker">`. */
class LegacyMarker {
  public static isInline = true;
  public static title = 'Marker';
  public static sanitize = { mark: { class: 'cdx-marker' } };
  public render(): HTMLElement {
    return document.createElement('button');
  }
}

const boot = async (html: string, extra: Record<string, unknown> = {}): Promise<Core> => {
  const holder = document.createElement('div');

  document.body.appendChild(holder);
  const core = new Core({
    holder,
    tabSync: false,
    i18n: { locale: 'en' },
    tools: { paragraph: { class: Paragraph }, spark: { class: ClassedSpan }, ...extra },
    data: { blocks: [{ id: 'p', type: 'paragraph', data: { text: html } }] },
  });

  await core.isReady;

  return core;
};

const savedText = async (core: Core): Promise<unknown> => {
  const saved = await core.moduleInstances.Saver.save();
  const block: OutputBlockData | undefined = saved?.blocks.find(entry => entry.id === 'p');

  return block?.data.text;
};

// Booting a real editor is slow on a busy machine.
describe('a custom inline tool on a tag the block tool also rules', { timeout: 30_000 }, () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('keeps the custom tool\'s span with its declared class through load and save', async () => {
    const core = await boot('a <span class="cdx-x">x</span> b');

    expect(await savedText(core)).toEqual([
      { text: 'a ' },
      { text: 'x', marks: { 'tag:span': { class: 'cdx-x' } } },
      { text: ' b' },
    ]);
  });

  it('still unwraps a bare span and a span with an undeclared class', async () => {
    const core = await boot('a <span>x</span> <span class="other">y</span> b');

    expect(await savedText(core)).toEqual([{ text: 'a x y b' }]);
  });

  it('still keeps an equation span', async () => {
    const core = await boot('a <span data-latex="x^2">x^2</span> b');

    expect(await savedText(core)).toEqual([
      { text: 'a ' },
      { embed: { equation: { expression: 'x^2' } } },
      { text: ' b' },
    ]);
  });

  it('reads a legacy cdx-marker mark as a highlight, with or without a host marker tool', async () => {
    const html = 'a <mark class="cdx-marker">x</mark> b';
    const expected = [{ text: 'a ' }, { text: 'x', marks: { highlight: true } }, { text: ' b' }];

    expect(await savedText(await boot(html))).toEqual(expected);
    document.body.innerHTML = '';
    expect(await savedText(await boot(html, { legacyMarker: { class: LegacyMarker } }))).toEqual(expected);
  });
});
