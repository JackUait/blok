import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { reserveGap, releaseGap } from '../../../../../src/components/modules/assistant/gap';
import { createLivePreview } from '../../../../../src/components/modules/assistant/live-preview';
import type { LivePreview } from '../../../../../src/components/modules/assistant/live-preview';

const PREVIEW = '[data-blok-ai-preview]';
const SLOT = '[data-blok-ai-slot]';
const BOX_HEIGHT = 48;
const HOLDER_HEIGHT = 24;

const execute = (...commands: unknown[]): string => JSON.stringify({ commands });

/** A finished call's JSON cut just before its closing characters, so the last command stays open. */
const open = (json: string, cut: string): string => json.slice(0, json.indexOf(cut) + cut.length);

const words = (layer: HTMLElement): string[] =>
  [...layer.querySelectorAll('.blok-ai-word')].map((word) => (word.textContent ?? '').trim());

const tails = (layer: HTMLElement): string[] =>
  [...layer.querySelectorAll('.blok-ai-tail')].map((word) => (word.textContent ?? '').trim());

const gapOf = (holder: HTMLElement): number => parseFloat(holder.style.getPropertyValue('--blok-ai-gap'));

describe('createLivePreview', () => {
  const frames: FrameRequestCallback[] = [];
  const state: { layer: HTMLElement; container: HTMLElement; holders: HTMLElement[]; preview: LivePreview | null } = {
    layer: document.createElement('div'),
    container: document.createElement('div'),
    holders: [],
    preview: null,
  };

  /** Per-element rects that override the default layout below. */
  const rects = new Map<HTMLElement, DOMRect>();

  const runFrames = (): void => {
    frames.splice(0).forEach((frame) => frame(0));
  };

  const make = (): LivePreview => {
    const preview = createLivePreview({
      layer: state.layer,
      holderOf: (id) => state.container.querySelector<HTMLElement>(`[data-blok-id="${id}"]`),
      edgeHolder: (edge) => (edge === 'start' ? state.holders[0] : state.holders[state.holders.length - 1]) ?? null,
      anchorHolder: () => state.holders[1] ?? null,
    });

    state.preview = preview;

    return preview;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.stubGlobal('requestAnimationFrame', (frame: FrameRequestCallback): number => frames.push(frame));
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query }));

    state.layer = document.createElement('div');
    state.container = document.createElement('div');
    state.holders = ['b1', 'b2', 'b3'].map((id) => {
      const holder = document.createElement('div');

      holder.setAttribute('data-blok-element', '');
      holder.setAttribute('data-blok-id', id);
      state.container.appendChild(holder);

      return holder;
    });
    state.layer.appendChild(state.container);
    document.body.appendChild(state.layer);

    // jsdom has no layout: holders stack 24px apart, every preview box is 48px tall.
    rects.clear();
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement): DOMRect {
      const fixed = rects.get(this);

      if (fixed) {
        return fixed;
      }
      const index = state.holders.indexOf(this);

      if (index >= 0) {
        return new DOMRect(0, index * HOLDER_HEIGHT, 600, HOLDER_HEIGHT);
      }

      return new DOMRect(0, 0, 600, this.matches(PREVIEW) ? BOX_HEIGHT : 0);
    });
  });

  afterEach(() => {
    state.preview?.clear();
    state.preview = null;
    state.layer.remove();
    frames.length = 0;
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('opens slots after the target holder and grows the gap', () => {
    const preview = make();
    const json = execute({ name: 'block.insert', args: { position: { after: 'b1' }, type: 'paragraph', data: { text: '' } } });

    preview.update('c1', open(json, '"text":"'));

    const slots = [...state.layer.querySelectorAll(SLOT)];
    const b1 = state.holders[0];

    expect(slots).toHaveLength(2);
    expect(slots.every((slot) => !state.container.contains(slot))).toBe(true);
    expect(b1.hasAttribute('data-blok-ai-gap')).toBe(true);
    expect(gapOf(b1)).toBe(BOX_HEIGHT);
    expect(state.holders[1].hasAttribute('data-blok-ai-gap')).toBe(false);
  });

  it('streams words into the overlay with the tail on the last two', () => {
    const preview = make();
    const json = execute({ name: 'block.insert', args: { position: { after: 'b1' }, type: 'paragraph', data: { text: 'Hello brave new world' } } });

    preview.update('c1', open(json, 'world'));

    // A burst still lands one word at a time.
    expect(words(state.layer)).toEqual(['Hello']);
    expect(state.layer.querySelectorAll(SLOT)).toHaveLength(0);

    vi.advanceTimersByTime(35);
    expect(words(state.layer)).toEqual(['Hello', 'brave']);

    vi.advanceTimersByTime(35 * 5);
    // "world" may still grow, so it waits.
    expect(words(state.layer)).toEqual(['Hello', 'brave', 'new']);
    expect(tails(state.layer)).toEqual(['brave', 'new']);

    preview.update('c1', json);
    vi.advanceTimersByTime(35);
    expect(words(state.layer)).toEqual(['Hello', 'brave', 'new', 'world']);
    // The block is finished: the tail fades back to ink.
    expect(tails(state.layer)).toEqual([]);
  });

  it('uses the real paragraph and header classes for type size', () => {
    const preview = make();
    const json = execute(
      { name: 'block.insert', args: { position: { after: 'b1' }, type: 'header', data: { text: 'Plan', level: 3 } } },
      { name: 'block.insert', args: { position: { after: 'b1' }, type: 'paragraph', data: { text: 'Body' } } }
    );

    preview.update('c1', json);
    vi.advanceTimersByTime(35 * 4);

    const heading = state.layer.querySelector('[data-blok-heading-level="3"]');
    const paragraph = state.layer.querySelector('.blok-block');

    expect(heading?.tagName).toBe('H3');
    expect(heading?.classList.contains('text-xl')).toBe(true);
    expect(heading?.textContent?.trim()).toBe('Plan');
    expect(paragraph?.textContent?.trim()).toBe('Body');
  });

  it('draws markdown as a heading and list items', () => {
    const preview = make();
    const json = execute({ name: 'markdown.insert', args: { position: { after: 'b3' }, markdown: '## Steps\n- one\n- two' } });

    preview.update('c1', json);
    vi.advanceTimersByTime(35 * 10);

    expect(state.layer.querySelector('[data-blok-heading-level="2"]')?.textContent?.trim()).toBe('Steps');
    expect([...state.layer.querySelectorAll('[data-list-style="unordered"]')].map((item) => item.textContent?.replace('•', '').trim()))
      .toEqual(['one', 'two']);
  });

  it('keeps landed words in step when later text changes them', () => {
    const preview = make();
    const json = execute({ name: 'markdown.insert', args: { position: { after: 'b1' }, markdown: 'Hello world\nmore [the docs](u)' } });

    // A soft-wrapped line and a link still being written.
    preview.update('c1', open(json, 'world\\n'));
    vi.advanceTimersByTime(35 * 10);
    preview.update('c1', open(json, '[the d'));
    vi.advanceTimersByTime(35 * 10);
    preview.update('c1', json);
    vi.advanceTimersByTime(35 * 10);

    expect(state.layer.querySelector('.blok-block')?.textContent).toBe('Hello world more the docs');
  });

  it('lines the preview up with the real content column, not the holder', () => {
    const preview = make();
    const b1 = state.holders[0];
    const content = document.createElement('div');

    state.layer.setAttribute('data-blok-content-align', 'left');
    content.setAttribute('data-blok-element-content', '');
    b1.appendChild(content);
    rects.set(state.layer, new DOMRect(10, 0, 900, 300));
    rects.set(b1, new DOMRect(10, 0, 900, HOLDER_HEIGHT));
    rects.set(content, new DOMRect(66, 0, 650, HOLDER_HEIGHT));

    preview.update('c1', execute({ name: 'block.insert', args: { position: { after: 'b1' }, type: 'paragraph', data: { text: 'x' } } }));

    const box = state.layer.querySelector<HTMLElement>(PREVIEW);

    expect(box?.style.left).toBe('56px');
    expect(box?.style.width).toBe('650px');
  });

  it('keeps a literal < and & once the text is complete', () => {
    const preview = make();

    preview.update('c1', execute({ name: 'block.insert', args: { position: { after: 'b1' }, type: 'paragraph', data: { text: 'if a < b AT&T' } } }));
    vi.advanceTimersByTime(35 * 10);

    expect(words(state.layer)).toEqual(['if', 'a', '<', 'b', 'AT&T']);
  });

  it('strips markdown emphasis but keeps a lone asterisk', () => {
    const preview = make();

    preview.update('c1', execute({ name: 'markdown.insert', args: { position: { after: 'b1' }, markdown: '**Bold** and *it* `code` 2 * 3' } }));
    vi.advanceTimersByTime(35 * 20);

    expect(words(state.layer)).toEqual(['Bold', 'and', 'it', 'code', '2', '*', '3']);
  });

  it('never shows markup from inline HTML text', () => {
    const preview = make();
    const json = execute({ name: 'block.insert', args: { position: { after: 'b1' }, type: 'paragraph', data: { text: 'a <b class="x">bold</b> &amp; plain' } } });

    // A tag cut off mid-stream never shows as text.
    preview.update('c1', open(json, '<b '));
    vi.advanceTimersByTime(35 * 3);
    expect(words(state.layer)).toEqual(['a']);

    preview.update('c1', json);
    vi.advanceTimersByTime(35 * 10);

    expect(words(state.layer)).toEqual(['a', 'bold', '&', 'plain']);
    expect(state.layer.querySelector('b')).toBeNull();
  });

  it('draws nothing for a command whose name is still cut off', () => {
    const preview = make();

    preview.update('c1', '{"commands":[{"name":"block.ins');

    expect(state.layer.querySelector(PREVIEW)).toBeNull();
    expect(state.holders.some((holder) => holder.hasAttribute('data-blok-ai-gap'))).toBe(false);
  });

  it('places an insert at the bar\'s block below the bar', () => {
    const preview = make();
    const bar = state.holders[1];
    const barPx = 40;

    reserveGap(bar, 'bar', barPx);
    // No position yet: while the call streams, the slots wait under the bar.
    preview.update('c1', open(execute({ name: 'block.insert', args: { type: 'paragraph', data: { text: 'Hi' } } }), 'Hi'));

    const box = state.layer.querySelector<HTMLElement>(PREVIEW);
    const barBottom = 2 * HOLDER_HEIGHT;

    expect(parseFloat(box?.style.top ?? '')).toBeGreaterThanOrEqual(barBottom + barPx);
    expect(gapOf(bar)).toBe(barPx + BOX_HEIGHT);

    releaseGap(bar, 'bar');
  });

  it('moves a finished insert with no position to the end, where the executor puts it', () => {
    const preview = make();

    preview.update('c1', execute({ name: 'block.insert', args: { type: 'paragraph', data: { text: 'Hi' } } }));

    expect(state.holders[1].hasAttribute('data-blok-ai-gap')).toBe(false);
    expect(gapOf(state.holders[2])).toBe(BOX_HEIGHT);
  });

  it('stacks a $ref insert after the preview item it names', () => {
    const preview = make();

    preview.update('c1', execute(
      { name: 'block.insert', ref: 'h', args: { position: { after: 'b1' }, type: 'header', data: { text: 'Head' } } },
      { name: 'block.insert', args: { position: { after: '$h' }, type: 'paragraph', data: { text: 'Body' } } }
    ));
    vi.advanceTimersByTime(35 * 4);

    const box = state.layer.querySelector(PREVIEW);

    expect(state.layer.querySelectorAll(PREVIEW)).toHaveLength(1);
    expect([...(box?.querySelectorAll('h2, .blok-block') ?? [])].map((block) => block.textContent?.trim())).toEqual(['Head', 'Body']);
  });

  it('opens the gap above a first block for an insert before it', () => {
    const preview = make();

    preview.update('c1', execute({ name: 'block.insert', args: { position: { before: 'b1' }, type: 'paragraph', data: { text: '' } } }));

    const b1 = state.holders[0];

    expect(b1.getAttribute('data-blok-ai-gap')).toBe('start');
    expect(parseFloat(b1.style.getPropertyValue('--blok-ai-gap-start'))).toBe(BOX_HEIGHT);
  });

  it('settle removes the overlay and the gap on the next frame', () => {
    const preview = make();
    const json = execute({ name: 'block.insert', args: { position: { after: 'b1' }, type: 'paragraph', data: { text: 'one two three' } } });

    preview.update('c1', json);
    preview.settle('c1');

    // Settle lands every queued word before the hand-off.
    expect(words(state.layer)).toEqual(['one', 'two', 'three']);
    expect(state.layer.querySelector(PREVIEW)).not.toBeNull();

    runFrames();

    const b1 = state.holders[0];

    expect(state.layer.querySelector(PREVIEW)).toBeNull();
    expect(b1.hasAttribute('data-blok-ai-gap')).toBe(false);
    expect(b1.style.getPropertyValue('--blok-ai-gap')).toBe('');
  });

  it('cancel removes everything at once', () => {
    const preview = make();

    preview.update('c1', execute({ name: 'block.insert', args: { position: { after: 'b2' }, type: 'paragraph', data: { text: 'gone' } } }));
    preview.cancel('c1');

    expect(state.layer.querySelector(PREVIEW)).toBeNull();
    expect(state.holders[1].hasAttribute('data-blok-ai-gap')).toBe(false);

    // A late delta for a finished call draws nothing.
    preview.update('c1', execute({ name: 'block.insert', args: { position: { after: 'b2' }, type: 'paragraph', data: { text: 'gone' } } }));
    expect(state.layer.querySelector(PREVIEW)).toBeNull();
  });

  it('clear ends every call, so a late delta draws nothing', () => {
    const preview = make();
    const json = execute({ name: 'block.insert', args: { position: { after: 'b2' }, type: 'paragraph', data: { text: 'late' } } });

    preview.update('c1', json);
    preview.clear();
    preview.update('c1', json);

    expect(state.layer.querySelector(PREVIEW)).toBeNull();
  });

  it('never adds a node to the block container', () => {
    const preview = make();
    const count = state.container.childElementCount;
    const json = execute(
      { name: 'block.insert', args: { position: { after: 'b1' }, type: 'header', data: { text: 'Title' } } },
      { name: 'markdown.insert', args: { position: 'end', markdown: '- a\n- b' } }
    );

    preview.update('c1', open(json, 'Title'));
    expect(state.container.childElementCount).toBe(count);
    preview.update('c1', json);
    preview.settle('c1');
    expect(state.container.childElementCount).toBe(count);
    runFrames();
    preview.update('c2', json);
    preview.cancel('c2');
    expect(state.container.childElementCount).toBe(count);
    expect(state.holders.every((holder) => holder.childElementCount === 0)).toBe(true);
  });

  it('finds a content column wrapped by a tune', () => {
    const preview = make();
    const b1 = state.holders[0];
    const tune = document.createElement('div');
    const content = document.createElement('div');

    content.setAttribute('data-blok-element-content', '');
    tune.appendChild(content);
    b1.appendChild(tune);
    rects.set(state.layer, new DOMRect(10, 0, 900, 300));
    rects.set(content, new DOMRect(66, 0, 650, HOLDER_HEIGHT));

    preview.update('c1', execute({ name: 'block.insert', args: { position: { after: 'b1' }, type: 'paragraph', data: { text: 'x' } } }));

    const box = state.layer.querySelector<HTMLElement>(PREVIEW);

    expect(box?.style.left).toBe('56px');
    expect(box?.style.width).toBe('650px');
  });

  it('never takes a nested child block\'s content column', () => {
    const preview = make();
    const b1 = state.holders[0];
    const child = document.createElement('div');
    const childContent = document.createElement('div');

    child.setAttribute('data-blok-element', '');
    childContent.setAttribute('data-blok-element-content', '');
    child.appendChild(childContent);
    b1.appendChild(child);
    rects.set(state.layer, new DOMRect(10, 0, 900, 300));
    rects.set(b1, new DOMRect(10, 0, 900, HOLDER_HEIGHT));
    rects.set(childContent, new DOMRect(100, 0, 300, HOLDER_HEIGHT));

    preview.update('c1', execute({ name: 'block.insert', args: { position: { after: 'b1' }, type: 'paragraph', data: { text: 'x' } } }));

    const box = state.layer.querySelector<HTMLElement>(PREVIEW);

    expect(box?.style.left).toBe('0px');
    expect(box?.style.width).toBe('900px');
  });

  describe('rewrites', () => {
    const REWRITING = 'data-blok-ai-rewriting';

    /** Gives a holder a content column with one editable field. */
    const field = (holder: HTMLElement, text: string): HTMLElement => {
      const content = document.createElement('div');
      const input = document.createElement('div');

      content.setAttribute('data-blok-element-content', '');
      input.setAttribute('contenteditable', 'true');
      input.textContent = text;
      content.appendChild(input);
      holder.appendChild(content);

      return input;
    };

    const boxText = (): string => state.layer.querySelector(PREVIEW)?.textContent ?? '';

    it('whole-field replace hides the block and streams the new text', () => {
      const preview = make();
      const b1 = state.holders[0];
      const input = field(b1, 'Old text here');
      const json = execute({ name: 'text.replace', args: { id: 'b1', with: 'New words land' } });

      rects.set(state.layer, new DOMRect(10, 0, 900, 300));
      rects.set(input, new DOMRect(66, 30, 650, BOX_HEIGHT));

      preview.update('c1', open(json, 'land'));
      vi.advanceTimersByTime(35 * 5);

      const box = state.layer.querySelector<HTMLElement>(PREVIEW);

      expect(b1.hasAttribute(REWRITING)).toBe(true);
      expect(words(state.layer)).toEqual(['New', 'words']);
      expect(tails(state.layer)).toEqual(['New', 'words']);
      expect(boxText()).not.toContain('Old');
      expect(state.container.contains(box)).toBe(false);
      expect(box?.style.left).toBe('56px');
      expect(box?.style.top).toBe('30px');
      expect(box?.style.width).toBe('650px');
      // The real text is untouched; only the overlay changes.
      expect(input.textContent).toBe('Old text here');

      preview.update('c1', json);
      preview.settle('c1');
      expect(words(state.layer)).toEqual(['New', 'words', 'land']);
      // The block stays hidden until the overlay goes, so the old text never flashes.
      expect(b1.hasAttribute(REWRITING)).toBe(true);

      runFrames();
      expect(b1.hasAttribute(REWRITING)).toBe(false);
      expect(state.layer.querySelector(PREVIEW)).toBeNull();
    });

    it('waits for the target id to finish streaming', () => {
      const preview = make();
      const b1 = state.holders[0];

      field(b1, 'Old');
      // "b1" may still grow into "b12".
      preview.update('c1', '{"commands":[{"name":"text.replace","args":{"id":"b1');

      expect(b1.hasAttribute(REWRITING)).toBe(false);
      expect(state.layer.querySelector(PREVIEW)).toBeNull();
    });

    it('range replace keeps the text outside the range visible', () => {
      const preview = make();

      field(state.holders[0], 'Hello brave world');
      preview.update('c1', execute({ name: 'text.replace', args: { id: 'b1', range: { start: 6, end: 11 }, with: 'kind' } }));
      vi.advanceTimersByTime(35 * 3);

      expect(boxText()).toBe('Hello kind world');
      expect(words(state.layer)).toEqual(['kind']);
    });

    it('find replace previews at the second occurrence', () => {
      const preview = make();

      field(state.holders[0], 'one cat two cat three');
      preview.update('c1', execute({ name: 'text.replace', args: { id: 'b1', range: { find: 'cat', occurrence: 2 }, with: 'dog' } }));
      vi.advanceTimersByTime(35 * 3);

      expect(boxText()).toBe('one cat two dog three');
    });

    it('a find that is not in the text shows no preview', () => {
      const preview = make();
      const b1 = state.holders[0];

      field(b1, 'one cat');
      preview.update('c1', execute({ name: 'text.replace', args: { id: 'b1', range: { find: 'zebra' }, with: 'dog' } }));

      expect(b1.hasAttribute(REWRITING)).toBe(false);
      expect(state.layer.querySelector(PREVIEW)).toBeNull();
    });

    it('drops the preview when a late range misses, and draws no insert for it', () => {
      const preview = make();
      const b1 = state.holders[0];

      field(b1, 'one cat');
      // `range` after `with`: the preview starts as a whole replace.
      preview.update('c1', '{"commands":[{"name":"text.replace","args":{"id":"b1","with":"dog"');
      expect(b1.hasAttribute(REWRITING)).toBe(true);

      preview.update('c1', execute({ name: 'text.replace', args: { id: 'b1', with: 'dog', range: { find: 'zebra' } } }));

      expect(b1.hasAttribute(REWRITING)).toBe(false);
      expect(state.layer.querySelector(PREVIEW)).toBeNull();
      expect(state.holders.some((holder) => holder.hasAttribute('data-blok-ai-gap'))).toBe(false);
    });

    it('block.update with data.text previews like a whole replace', () => {
      const preview = make();
      const b2 = state.holders[1];

      field(b2, 'Before');
      preview.update('c1', execute({ name: 'block.update', args: { id: 'b2', data: { text: 'After <b>this</b>' } } }));
      vi.advanceTimersByTime(35 * 3);

      expect(b2.hasAttribute(REWRITING)).toBe(true);
      expect(boxText()).toBe('After this');
    });

    it('block.update without text leaves the block alone', () => {
      const preview = make();
      const b2 = state.holders[1];

      field(b2, 'Before');
      preview.update('c1', execute({ name: 'block.update', args: { id: 'b2', data: { style: 'ordered' } } }));

      expect(b2.hasAttribute(REWRITING)).toBe(false);
      expect(state.layer.querySelector(PREVIEW)).toBeNull();
    });

    it('cancel shows the original block again', () => {
      const preview = make();
      const b1 = state.holders[0];

      field(b1, 'Old');
      preview.update('c1', open(execute({ name: 'text.replace', args: { id: 'b1', with: 'New text' } }), 'New '));
      preview.cancel('c1');

      expect(b1.hasAttribute(REWRITING)).toBe(false);
      expect(state.layer.querySelector(PREVIEW)).toBeNull();
    });

    it('clear shows the original block again', () => {
      const preview = make();
      const b1 = state.holders[0];

      field(b1, 'Old');
      preview.update('c1', execute({ name: 'text.replace', args: { id: 'b1', with: 'New' } }));
      preview.clear();

      expect(b1.hasAttribute(REWRITING)).toBe(false);
      expect(state.layer.querySelector(PREVIEW)).toBeNull();
    });

    it('a longer rewrite of the bar\'s block pushes the bar down, not over the new text', () => {
      const preview = make();
      const b1 = state.holders[0];
      const input = field(b1, 'Short');

      reserveGap(b1, 'bar', 40);
      rects.set(input, new DOMRect(0, 0, 600, HOLDER_HEIGHT));
      preview.update('c1', execute({ name: 'text.replace', args: { id: 'b1', with: 'A much longer text' } }));

      // The bar re-reads its spot: it now sits under the rewrite's extra height.
      expect(reserveGap(b1, 'bar', 40)).toBe(BOX_HEIGHT - HOLDER_HEIGHT);

      releaseGap(b1, 'bar');
    });

    it('sizes the rewrite box like the field, padding included', () => {
      const preview = make();
      const input = field(state.holders[0], 'Old');

      input.style.whiteSpace = 'pre-wrap';
      preview.update('c1', execute({ name: 'text.replace', args: { id: 'b1', with: 'New' } }));

      const box = state.layer.querySelector<HTMLElement>(PREVIEW);

      expect(box?.style.boxSizing).toBe('border-box');
      expect(box?.style.whiteSpace).toBe('pre-wrap');
    });

    it('keeps a space the new text starts with', () => {
      const preview = make();

      field(state.holders[0], 'Hello brave world');
      preview.update('c1', execute({ name: 'text.replace', args: { id: 'b1', range: { start: 5, end: 11 }, with: ' kind' } }));
      vi.advanceTimersByTime(35 * 3);

      expect(boxText()).toBe('Hello kind world');
    });

    it('holds the extra height of a longer rewrite in the gap, and frees it', () => {
      const preview = make();
      const b1 = state.holders[0];
      const input = field(b1, 'Short');

      rects.set(input, new DOMRect(0, 0, 600, HOLDER_HEIGHT));
      preview.update('c1', execute({ name: 'text.replace', args: { id: 'b1', with: 'A much longer text' } }));

      expect(gapOf(b1)).toBe(BOX_HEIGHT - HOLDER_HEIGHT);

      preview.settle('c1');
      runFrames();
      expect(b1.hasAttribute('data-blok-ai-gap')).toBe(false);
    });
  });

  it('reduced motion skips the shimmer class', () => {
    const json = execute({ name: 'block.insert', args: { position: { after: 'b1' }, type: 'paragraph', data: { text: '' } } });

    make().update('c1', open(json, '"text":"'));
    expect([...state.layer.querySelectorAll(SLOT)].every((slot) => slot.classList.contains('blok-ai-shimmer'))).toBe(true);
    state.preview?.clear();

    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce'), media: query }));
    make().update('c2', open(json, '"text":"'));

    const slots = [...state.layer.querySelectorAll(SLOT)];

    expect(slots).toHaveLength(2);
    expect(slots.some((slot) => slot.classList.contains('blok-ai-shimmer'))).toBe(false);
  });
});
