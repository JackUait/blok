import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { onGapChange, reserveGap, releaseGap } from '../../../../../src/components/modules/assistant/gap';
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

  describe('layout per frame', () => {
    const insertAfter = (id: string, text: string): string =>
      execute({ name: 'block.insert', args: { position: { after: id }, type: 'paragraph', data: { text } } });

    it('writes no gap or box position until the frame, however many deltas arrive', () => {
      const preview = make();
      const b1 = state.holders[0];
      const json = insertAfter('b1', 'One two three four five');

      preview.update('c1', open(json, 'One '));
      preview.update('c1', open(json, 'two '));
      preview.update('c1', open(json, 'three '));

      const box = state.layer.querySelector<HTMLElement>(PREVIEW);

      expect(b1.hasAttribute('data-blok-ai-gap')).toBe(false);
      expect(box?.style.top).toBe('');

      runFrames();

      expect(gapOf(b1)).toBe(BOX_HEIGHT);
      expect(box?.style.top).toBe(`${HOLDER_HEIGHT}px`);
    });

    it('reads every size before it writes a gap, then reads positions once', () => {
      const preview = make();
      const log: string[] = [];
      const rect = vi.mocked(HTMLElement.prototype.getBoundingClientRect);
      const layout = rect.getMockImplementation();

      rect.mockImplementation(function (this: HTMLElement): DOMRect {
        log.push('read');

        return layout === undefined ? new DOMRect() : layout.call(this);
      });
      const unsubscribe = onGapChange(() => log.push('gap'));
      const setProperty = CSSStyleDeclaration.prototype.setProperty;

      vi.spyOn(CSSStyleDeclaration.prototype, 'setProperty').mockImplementation(function (this: CSSStyleDeclaration, name: string, value: string | null, priority?: string): void {
        if (name.startsWith('--blok-ai-gap')) {
          log.push('write');
        }
        setProperty.call(this, name, value, priority);
      });

      preview.update('c1', insertAfter('b1', 'One two '));
      preview.update('c2', insertAfter('b2', 'Three four '));
      log.length = 0;
      runFrames();
      unsubscribe();

      // Sizes, then both gaps, then positions; listeners hear once, at the end.
      expect(log.join(' ')).toMatch(/^(read )+(write )+(read )+gap$/);
    });

    it('tells gap listeners once per frame, with every holder whose gap changed', () => {
      const preview = make();
      const heard: HTMLElement[][] = [];
      const unsubscribe = onGapChange((holders) => heard.push(holders));

      preview.update('c1', insertAfter('b1', 'One two '));
      preview.update('c2', insertAfter('b2', 'Three four '));
      runFrames();
      unsubscribe();

      expect(heard).toEqual([[state.holders[0], state.holders[1]]]);
    });
  });

  it('opens slots after the target holder and grows the gap', () => {
    const preview = make();
    const json = execute({ name: 'block.insert', args: { position: { after: 'b1' }, type: 'paragraph', data: { text: '' } } });

    preview.update('c1', open(json, '"text":"'));
    runFrames();

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
    runFrames();

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

  it('shows escaped markup as literal text, never as an element', () => {
    const preview = make();

    preview.update('c1', execute({ name: 'block.insert', args: { position: { after: 'b1' }, type: 'paragraph', data: { text: '&lt;img src=x onerror=alert(1)&gt; <<b>script>' } } }));
    vi.advanceTimersByTime(35 * 10);

    expect(words(state.layer)).toEqual(['<img', 'src=x', 'onerror=alert(1)>', 'script>']);
    expect(state.layer.querySelector('img, script, b')).toBeNull();
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
    runFrames();

    const box = state.layer.querySelector<HTMLElement>(PREVIEW);
    const barBottom = 2 * HOLDER_HEIGHT;

    expect(parseFloat(box?.style.top ?? '')).toBeGreaterThanOrEqual(barBottom + barPx);
    expect(gapOf(bar)).toBe(barPx + BOX_HEIGHT);

    releaseGap(bar, 'bar');
  });

  it('moves a finished insert with no position to the end, where the executor puts it', () => {
    const preview = make();

    preview.update('c1', execute({ name: 'block.insert', args: { type: 'paragraph', data: { text: 'Hi' } } }));
    runFrames();

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
    runFrames();

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

  it('relayout re-places the boxes once, on the next frame, after the page moves', () => {
    const preview = make();
    const b1 = state.holders[0];

    preview.update('c1', execute({ name: 'block.insert', args: { position: { after: 'b1' }, type: 'paragraph', data: { text: 'moving' } } }));
    runFrames();
    const box = state.layer.querySelector<HTMLElement>(PREVIEW);
    const before = parseFloat(box?.style.top ?? '');

    rects.set(b1, new DOMRect(0, -100, 600, HOLDER_HEIGHT));
    // A landed word asks for a frame of its own.
    const queued = frames.length;

    preview.relayout();
    preview.relayout();

    expect(frames).toHaveLength(queued + 1);
    expect(parseFloat(box?.style.top ?? '')).toBe(before);

    runFrames();

    expect(parseFloat(box?.style.top ?? '')).toBe(before - 100);
  });

  it('clear cancels a pending relayout frame', () => {
    const cancelFrame = vi.fn();

    vi.stubGlobal('cancelAnimationFrame', cancelFrame);
    const preview = make();

    preview.relayout();
    preview.clear();

    expect(cancelFrame).toHaveBeenCalledExactlyOnceWith(1);

    preview.relayout();
    expect(frames).toHaveLength(2);
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
    runFrames();

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
    runFrames();

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
      runFrames();

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

    it('find replace previews the span commit replaces: case folds, and Whole word skips a longer word', () => {
      const preview = make();

      field(state.holders[0], 'Cat catalog');
      preview.update('c1', execute({ name: 'text.replace', args: { id: 'b1', range: { find: 'cat', wholeWord: true }, with: 'dog' } }));
      vi.advanceTimersByTime(35 * 3);

      expect(boxText()).toBe('dog catalog');
    });

    it('a replace-all shows no single-span preview', () => {
      const preview = make();
      const b1 = state.holders[0];

      field(b1, 'one cat two cat');
      preview.update('c1', execute({ name: 'text.replace', args: { id: 'b1', range: { find: 'cat', all: true }, with: 'dog' } }));

      expect(state.layer.querySelector(PREVIEW)).toBeNull();
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

    it('shows the text after a range that settles once words have landed', () => {
      const preview = make();

      field(state.holders[0], 'abc def');
      // `range` after `with`: words land as a whole replace first.
      preview.update('c1', '{"commands":[{"name":"text.replace","args":{"id":"b1","with":"one two"');
      vi.advanceTimersByTime(35 * 3);
      expect(words(state.layer)).toEqual(['one']);

      preview.update('c1', execute({ name: 'text.replace', args: { id: 'b1', with: 'one two', range: { start: 0, end: 3 } } }));
      vi.advanceTimersByTime(35 * 3);

      expect(boxText()).toBe('one two def');
    });

    it('skips a block whose child blocks show, so nothing draws over them', () => {
      const preview = make();
      const b1 = state.holders[0];
      const input = field(b1, 'Title');
      const child = document.createElement('div');

      child.setAttribute('data-blok-element', '');
      input.after(child);
      preview.update('c1', execute({ name: 'text.replace', args: { id: 'b1', with: 'A new title' } }));

      expect(state.layer.querySelector(PREVIEW)).toBeNull();
      expect(b1.hasAttribute(REWRITING)).toBe(false);
      expect(b1.hasAttribute('data-blok-ai-gap')).toBe(false);
    });

    it('names the blocks it framed, even after the call settles, and not one it skipped', () => {
      const preview = make();
      const b1 = state.holders[0];
      const child = document.createElement('div');

      field(b1, 'Title').after(child);
      child.setAttribute('data-blok-element', '');
      field(state.holders[1], 'Plain');
      preview.update('c1', execute(
        { name: 'text.replace', args: { id: 'b1', with: 'A new title' } },
        { name: 'text.replace', args: { id: 'b2', with: 'New plain' } }
      ));
      preview.settle('c1');
      runFrames();

      expect(preview.framed('c1')).toEqual(['b2']);
      expect(preview.framed('c2')).toEqual([]);
    });

    it('previews a block whose child blocks are collapsed', () => {
      const preview = make();
      const b1 = state.holders[0];
      const input = field(b1, 'Title');
      const child = document.createElement('div');

      child.setAttribute('data-blok-element', '');
      child.classList.add('hidden');
      input.after(child);
      preview.update('c1', execute({ name: 'text.replace', args: { id: 'b1', with: 'A new title' } }));

      expect(b1.hasAttribute(REWRITING)).toBe(true);
    });

    it.each([
      ['a fractional offset', { start: 0.5, end: 2 }],
      ['occurrence 0', { find: 'cat', occurrence: 0 }],
      ['a fractional occurrence', { find: 'cat', occurrence: 1.5 }],
    ])('shows no preview for a range the executor rejects: %s', (_label, range) => {
      const preview = make();
      const b1 = state.holders[0];

      field(b1, 'one cat');
      preview.update('c1', execute({ name: 'text.replace', args: { id: 'b1', range, with: 'dog' } }));

      expect(b1.hasAttribute(REWRITING)).toBe(false);
      expect(state.layer.querySelector(PREVIEW)).toBeNull();
    });

    it('block.update with rich segments in data.text streams their plain text', () => {
      const preview = make();
      const b2 = state.holders[1];
      const json = execute({ name: 'block.update', args: { id: 'b2', data: { text: [{ text: 'After ' }, { text: 'this <b>', marks: { bold: true } }, { text: ' now' }] } } });

      field(b2, 'Before');
      preview.update('c1', open(json, 'After '));
      vi.advanceTimersByTime(35 * 3);
      expect(b2.hasAttribute(REWRITING)).toBe(true);
      expect(words(state.layer)).toEqual(['After']);

      preview.update('c1', json);
      vi.advanceTimersByTime(35 * 5);
      // Segment text is plain text: a "<b>" in it is shown, not read as a tag.
      expect(boxText()).toBe('After this <b> now');
      preview.settle('c1');
      expect(preview.framed('c1')).toEqual(['b2']);
    });

    it.each([
      ['block.update', (embed: unknown[]) => ({ name: 'block.update', args: { id: 'b2', data: { text: embed } } })],
      ['text.replace', (embed: unknown[]) => ({ name: 'text.replace', args: { id: 'b2', with: embed } })],
    ])('%s with an embed segment draws no overlay, even after words landed, and does not count the block as framed', (_name, command) => {
      const preview = make();
      const b2 = state.holders[1];
      const segments = [{ text: 'Sum of these words ' }, { embed: { equation: { expression: 'x^2' } } }, { text: ' end' }];
      const json = execute(command(segments));

      field(b2, 'Before');
      preview.update('c1', open(json, 'these '));
      vi.advanceTimersByTime(35 * 3);
      expect(b2.hasAttribute(REWRITING)).toBe(true);

      preview.update('c1', json);

      expect(b2.hasAttribute(REWRITING)).toBe(false);
      expect(state.layer.querySelector(PREVIEW)).toBeNull();
      expect(b2.hasAttribute('data-blok-ai-gap')).toBe(false);
      preview.settle('c1');
      runFrames();
      expect(preview.framed('c1')).toEqual([]);
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

    it('a second call waits for the first call\'s rewrite of the same block, then draws over the committed text', () => {
      const preview = make();
      const b1 = state.holders[0];
      const input = field(b1, 'The quick brown fox');
      const boxes = (): number => state.layer.querySelectorAll(PREVIEW).length;
      const hiddenWhileDrawn = (): boolean => boxes() === 0 || b1.hasAttribute(REWRITING);

      preview.update('c1', execute({ name: 'text.replace', args: { id: 'b1', range: { find: 'quick' }, with: 'slow' } }));
      vi.advanceTimersByTime(35 * 2);
      preview.update('c2', execute({ name: 'text.replace', args: { id: 'b1', range: { find: 'brown' }, with: 'red' } }));

      expect(boxes()).toBe(1);
      expect(boxText()).toBe('The slow brown fox');

      preview.settle('c1');
      preview.update('c2', execute({ name: 'text.replace', args: { id: 'b1', range: { find: 'brown' }, with: 'red' } }));
      expect(boxes()).toBe(1);

      // c1 commits, then its overlay goes on the next frame.
      input.textContent = 'The slow brown fox';
      runFrames();
      expect(hiddenWhileDrawn()).toBe(true);

      preview.update('c2', execute({ name: 'text.replace', args: { id: 'b1', range: { find: 'brown' }, with: 'red' } }));
      vi.advanceTimersByTime(35 * 2);

      expect(boxes()).toBe(1);
      expect(boxText()).toBe('The slow red fox');
      expect(hiddenWhileDrawn()).toBe(true);
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
      runFrames();

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
      runFrames();

      expect(gapOf(b1)).toBe(BOX_HEIGHT - HOLDER_HEIGHT);

      preview.settle('c1');
      runFrames();
      expect(b1.hasAttribute('data-blok-ai-gap')).toBe(false);
    });
  });

  it('reduced motion lands every word that has arrived at once, with no pacing', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce'), media: query }));
    const json = execute({ name: 'block.insert', args: { position: { after: 'b1' }, type: 'paragraph', data: { text: 'One two three four five' } } });

    make().update('c1', open(json, 'four '));

    expect(words(state.layer)).toEqual(['One', 'two', 'three', 'four']);
  });

  it('a call counts as shown only after a frame has painted one of its words', () => {
    const preview = make();
    const json = execute({ name: 'block.insert', args: { position: { after: 'b1' }, type: 'paragraph', data: { text: 'All at once' } } });

    preview.update('c1', json);
    expect(preview.shown('c1')).toBe(false);

    runFrames();
    expect(preview.shown('c1')).toBe(true);
  });

  it('a call with only slots drawn is never shown', () => {
    const preview = make();
    const json = execute({ name: 'block.insert', args: { position: { after: 'b1' }, type: 'paragraph', data: { text: '' } } });

    preview.update('c1', open(json, '"text":"'));
    runFrames();

    expect(preview.shown('c1')).toBe(false);
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

  describe('every block streams in its final form', () => {
    const CELL = '[data-blok-table-cell]';
    const markdown = (text: string): string =>
      execute({ name: 'markdown.insert', args: { position: { after: 'b1' }, markdown: text } });
    const cellTexts = (): string[] => [...state.layer.querySelectorAll(CELL)].map((cell) => cell.textContent?.trim() ?? '');
    const layerText = (): string => state.layer.querySelector(PREVIEW)?.textContent ?? '';

    it('draws a streaming Markdown table as a table, never as pipes', () => {
      const preview = make();
      const json = markdown('| Planet | Moons |\n| --- | --- |\n| Mars | 2 |');

      // Only the header row so far: the grid shows at once, before any word lands.
      preview.update('c1', open(json, 'Moons |'));
      expect(state.layer.querySelector('table')).not.toBeNull();
      expect(state.layer.querySelectorAll(CELL)).toHaveLength(2);
      expect(state.layer.querySelectorAll(SLOT)).toHaveLength(0);

      preview.update('c1', open(json, '| --- |'));
      preview.update('c1', json);
      vi.advanceTimersByTime(35 * 10);

      expect(layerText()).not.toMatch(/[|]|---/);
      expect(cellTexts()).toEqual(['Planet', 'Moons', 'Mars', '2']);
      expect(state.layer.querySelector('tr')?.hasAttribute('data-blok-table-heading')).toBe(true);
    });

    it('lands table words one at a time, in reading order', () => {
      const preview = make();

      preview.update('c1', markdown('| A | B |\n| - | - |\n| C | D |'));

      expect(words(state.layer)).toEqual(['A']);
      vi.advanceTimersByTime(35);
      expect(words(state.layer)).toEqual(['A', 'B']);
      vi.advanceTimersByTime(35 * 2);
      expect(cellTexts()).toEqual(['A', 'B', 'C', 'D']);
    });

    it('adds body rows without rebuilding the rows already drawn', () => {
      const preview = make();
      const json = markdown('| A | B |\n| - | - |\n| C | D |\n| E | F |');

      preview.update('c1', open(json, '| C | D |'));
      vi.advanceTimersByTime(35 * 10);

      const header = state.layer.querySelector('.blok-ai-word');

      preview.update('c1', json);
      vi.advanceTimersByTime(35 * 10);

      expect(state.layer.querySelector('.blok-ai-word')).toBe(header);
      expect(cellTexts()).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
    });

    it('places cells the way the delimiter row aligns them', () => {
      const preview = make();

      preview.update('c1', markdown('| A | B | C |\n| --- | :-: | --: |\n| 1 | 2 | 3 |'));
      vi.advanceTimersByTime(35 * 10);

      const placements = [...state.layer.querySelectorAll('tr:last-child [data-blok-table-cell-blocks]')]
        .map((cell) => cell.getAttribute('data-blok-cell-placement'));

      expect(placements).toEqual([null, 'top-center', 'top-right']);
    });

    it('drops an empty header row, as the importer does, and shows no heading', () => {
      const preview = make();

      preview.update('c1', markdown('|  |  |\n| - | - |\n| x | y |'));
      vi.advanceTimersByTime(35 * 10);

      expect(cellTexts()).toEqual(['x', 'y']);
      expect(state.layer.querySelector('[data-blok-table-heading]')).toBeNull();
    });

    it('shows a lone table row with no heading, as the importer does', () => {
      const preview = make();

      preview.update('c1', markdown('| A |\n| - |'));
      vi.advanceTimersByTime(35 * 10);

      expect(cellTexts()).toEqual(['A']);
      expect(state.layer.querySelector('[data-blok-table-heading]')).toBeNull();
    });

    it('turns a pipe line with no delimiter row back into a paragraph', () => {
      const preview = make();

      preview.update('c1', markdown('| a |\nnot a table'));
      vi.advanceTimersByTime(35 * 10);

      expect(state.layer.querySelector('table')).toBeNull();
      expect(state.layer.querySelector('.blok-block')?.textContent).toBe('| a | not a table');
    });

    it('draws a table from block.insert content', () => {
      const preview = make();
      const json = execute({
        name: 'block.insert',
        args: { position: { after: 'b1' }, type: 'table', data: { withHeadings: true, content: [['Name', 'Age'], ['Ann', '30']] } },
      });

      preview.update('c1', json);
      vi.advanceTimersByTime(35 * 10);

      expect(cellTexts()).toEqual(['Name', 'Age', 'Ann', '30']);
      expect(state.layer.querySelector('tr')?.hasAttribute('data-blok-table-heading')).toBe(true);
    });

    it('draws a code fence as a code block that keeps its spacing', () => {
      const preview = make();
      const json = markdown('```js\nconst a = 1;\n  - b\n```');

      preview.update('c1', open(json, 'const'));
      expect(state.layer.querySelector('[data-blok-testid="code-content"]')).not.toBeNull();

      preview.update('c1', json);
      vi.advanceTimersByTime(35 * 10);

      expect(state.layer.querySelector('[data-blok-testid="code-content"]')?.textContent).toBe('const a = 1;\n  - b');
      expect(state.layer.querySelectorAll('[data-line-index]')).toHaveLength(2);
      expect(layerText()).not.toContain('```');
      expect(layerText()).toContain('JavaScript');
      expect(state.layer.querySelector('[data-list-style]')).toBeNull();
    });

    it('draws a Markdown quote as a quote', () => {
      const preview = make();

      preview.update('c1', markdown('> quote **b**\n> more'));
      vi.advanceTimersByTime(35 * 10);

      const quote = state.layer.querySelector('blockquote');

      expect(quote?.classList.contains('border-s-[3px]')).toBe(true);
      expect(quote?.textContent).toBe('quote b more');
    });

    it('draws a thematic break as a divider, and a setext underline as a heading', () => {
      const preview = make();

      preview.update('c1', markdown('Title\n---\n\nbody\n\n---'));
      vi.advanceTimersByTime(35 * 10);

      expect(state.layer.querySelector('[data-blok-heading-level="2"]')?.textContent).toBe('Title');
      expect(state.layer.querySelectorAll('hr')).toHaveLength(1);
      expect(layerText()).not.toContain('---');
    });

    it('draws code, quote and divider from block.insert', () => {
      const preview = make();
      const json = execute(
        { name: 'block.insert', args: { position: { after: 'b1' }, type: 'code', data: { code: 'x = 1', language: 'python' } } },
        { name: 'block.insert', args: { position: { after: 'b1' }, type: 'quote', data: { text: 'Said' } } },
        { name: 'block.insert', args: { position: { after: 'b1' }, type: 'divider', data: {} } }
      );

      preview.update('c1', json);
      vi.advanceTimersByTime(35 * 10);

      expect(state.layer.querySelector('[data-blok-testid="code-content"]')?.textContent).toBe('x = 1');
      expect(state.layer.querySelector('blockquote')?.textContent).toBe('Said');
      expect(state.layer.querySelectorAll('hr')).toHaveLength(1);
      expect(state.layer.querySelectorAll(SLOT)).toHaveLength(0);
    });

    const CALLOUT = '[data-blok-tool="callout"]';
    const calloutBody = (): string => state.layer.querySelector(`${CALLOUT} [data-blok-nested-blocks]`)?.textContent ?? '';

    it('draws a GitHub alert as the callout the importer makes, never as a quote', () => {
      const preview = make();

      preview.update('c1', markdown('> [!NOTE]\n> Body **b**'));
      vi.advanceTimersByTime(35 * 10);

      const callout = state.layer.querySelector<HTMLElement>(CALLOUT);

      expect(callout?.querySelector('[data-blok-testid="callout-emoji-face"]')?.textContent).toBe('ℹ️');
      expect(callout?.style.backgroundColor).toBe('var(--blok-color-blue-bg)');
      expect(calloutBody()).toBe('Body b');
      expect(layerText()).not.toContain('[!');
      expect(state.layer.querySelector('blockquote')).toBeNull();
    });

    it('shows no marker text while the alert marker is still being written', () => {
      const preview = make();
      const json = markdown('> [!WARNING]\n> Careful');

      preview.update('c1', open(json, '[!WARN'));
      vi.advanceTimersByTime(35 * 10);

      expect(layerText()).not.toContain('[!');
      expect(state.layer.querySelector('blockquote')).toBeNull();

      preview.update('c1', open(json, '> Car'));
      vi.advanceTimersByTime(35 * 10);

      expect(state.layer.querySelector(CALLOUT)?.querySelector('[data-blok-testid="callout-emoji-face"]')?.textContent).toBe('⚠️');
    });

    it('keeps a lowercase marker a quote, as the importer does', () => {
      const preview = make();

      preview.update('c1', markdown('> [!note]\n> lower'));
      vi.advanceTimersByTime(35 * 10);

      expect(state.layer.querySelector(CALLOUT)).toBeNull();
      expect(state.layer.querySelector('blockquote')?.textContent).toBe('[!note] lower');
    });

    it('draws a callout body as its own blocks, and ends it at the first line without ">"', () => {
      const preview = make();

      preview.update('c1', markdown('> [!TIP] Lead\n> - one\n> - two\n\nafter'));
      vi.advanceTimersByTime(35 * 20);

      const callout = state.layer.querySelector(CALLOUT);

      expect(callout?.querySelectorAll('[data-list-style="unordered"]')).toHaveLength(2);
      expect(calloutBody()).toBe('Lead•one•two');
      expect(callout?.textContent).not.toContain('after');
      expect(layerText()).toContain('after');
    });

    it('draws a callout from block.insert', () => {
      const preview = make();
      const json = execute({ name: 'block.insert', args: { position: { after: 'b1' }, type: 'callout', data: { emoji: '🔥', backgroundColor: 'red' } } });

      preview.update('c1', json);
      vi.advanceTimersByTime(35 * 10);

      expect(state.layer.querySelector(CALLOUT)?.querySelector('[data-blok-testid="callout-emoji-face"]')?.textContent).toBe('🔥');
      expect(state.layer.querySelectorAll(SLOT)).toHaveLength(0);
    });

    const IMAGE = '[data-blok-tool="image"]';
    const caption = (): string => state.layer.querySelector(`${IMAGE} .blok-image-caption`)?.textContent ?? '';

    it('draws a lone Markdown image as the image block, its alt text as the caption', () => {
      const preview = make();

      preview.update('c1', markdown('![Red planet](https://example.com/mars.png)'));
      vi.advanceTimersByTime(35 * 10);

      expect(state.layer.querySelector(`${IMAGE} img`)?.getAttribute('src')).toBe('https://example.com/mars.png');
      expect(caption()).toBe('Red planet');
      expect(layerText()).not.toContain('![');
    });

    it('shows the image block while its URL streams, and loads nothing until the URL is whole', () => {
      const preview = make();
      const json = markdown('![Red planet](https://example.com/mars.png)\n\nafter');

      preview.update('c1', open(json, 'example.com/ma'));
      vi.advanceTimersByTime(35 * 10);

      expect(state.layer.querySelector(IMAGE)).not.toBeNull();
      expect(state.layer.querySelector(`${IMAGE} img`)?.hasAttribute('src') ?? false).toBe(false);
      expect(caption()).toBe('Red planet');
      expect(layerText()).not.toContain('example.com');

      preview.update('c1', json);
      vi.advanceTimersByTime(35 * 10);

      expect(state.layer.querySelector(`${IMAGE} img`)?.getAttribute('src')).toBe('https://example.com/mars.png');
    });

    it('never loads an image with an unsafe URL', () => {
      const preview = make();

      preview.update('c1', markdown('![x](javascript:alert(1))'));
      vi.advanceTimersByTime(35 * 10);

      expect(state.layer.querySelector('img')).toBeNull();
      expect(layerText()).not.toContain('javascript');
    });

    it('keeps an image inside a sentence a paragraph, as the importer does', () => {
      const preview = make();

      preview.update('c1', markdown('see ![a](https://example.com/a.png) here'));
      vi.advanceTimersByTime(35 * 10);

      expect(state.layer.querySelector(IMAGE)).toBeNull();
    });

    it('draws an image from block.insert', () => {
      const preview = make();
      const json = execute({ name: 'block.insert', args: { position: { after: 'b1' }, type: 'image', data: { url: 'https://example.com/b.png', caption: 'Moon' } } });

      preview.update('c1', json);
      vi.advanceTimersByTime(35 * 10);

      expect(state.layer.querySelector(`${IMAGE} img`)?.getAttribute('src')).toBe('https://example.com/b.png');
      expect(caption()).toBe('Moon');
    });

    const CODE = '[data-blok-tool="code"]';
    const codeTexts = (): string[] => [...state.layer.querySelectorAll('[data-blok-testid="code-content"]')].map((code) => code.textContent ?? '');
    const settle = async (): Promise<void> => {
      vi.advanceTimersByTime(35 * 20);
      await vi.dynamicImportSettled();
      await Promise.resolve();
      vi.advanceTimersByTime(1000);
      await vi.dynamicImportSettled();
    };

    it('draws a $$ block as the LaTeX block the importer makes, showing the rendered formula', async () => {
      const preview = make();

      preview.update('c1', markdown('$$\nE = mc^2\n$$'));
      await settle();

      const block = state.layer.querySelector(CODE);

      expect(block?.querySelector('[data-blok-testid="code-language-name"]')?.textContent).toBe('LaTeX');
      expect(block?.querySelector<HTMLElement>('[data-blok-testid="code-preview"]')?.hidden).toBe(false);
      expect(block?.querySelector('pre')?.hidden).toBe(true);
      expect(block?.querySelector('[data-blok-testid="code-mode-preview"]')?.getAttribute('aria-pressed')).toBe('true');
      expect(codeTexts()).toEqual(['E = mc^2']);
      expect(block?.querySelector('[data-blok-testid="code-preview"] .katex')).not.toBeNull();
      expect(layerText()).not.toContain('$$');
    });

    it('splits a paragraph around inline math, as the importer does', () => {
      const preview = make();

      preview.update('c1', markdown('text $x^2$ more'));
      vi.advanceTimersByTime(35 * 10);

      expect(codeTexts()).toEqual(['x^2']);
      expect([...state.layer.querySelectorAll('.blok-block')].map((block) => block.textContent)).toEqual(['text', 'more']);
    });

    it('keeps prices a paragraph', () => {
      const preview = make();

      preview.update('c1', markdown('costs $5 and $10'));
      vi.advanceTimersByTime(35 * 10);

      expect(state.layer.querySelector(CODE)).toBeNull();
      expect(state.layer.querySelector('.blok-block')?.textContent).toBe('costs $5 and $10');
    });

    it('draws code with the editable block\'s header, and no editable field in the overlay', () => {
      const preview = make();

      preview.update('c1', markdown('```python\nx = 1\n```'));
      vi.advanceTimersByTime(35 * 10);

      expect(state.layer.querySelector<HTMLElement>('[data-blok-testid="code-language-chevron"]')?.hidden).toBe(false);
      expect(state.layer.querySelector('[contenteditable]')).toBeNull();
      expect(state.layer.querySelector<HTMLElement>('[data-blok-testid="code-preview"]')?.hidden).toBe(true);
    });

    it('opens a mermaid fence in preview mode, as the real block does', () => {
      const preview = make();

      preview.update('c1', markdown('```mermaid\ngraph TD\n```'));
      vi.advanceTimersByTime(35 * 10);

      expect(state.layer.querySelector<HTMLElement>('[data-blok-testid="code-preview"]')?.hidden).toBe(false);
      expect(state.layer.querySelector('pre')?.hidden).toBe(true);
    });

    it('names a fence with no language the way the code tool does, through the editor\'s messages', () => {
      const preview = createLivePreview({
        layer: state.layer,
        holderOf: (id) => state.container.querySelector<HTMLElement>(`[data-blok-id="${id}"]`),
        edgeHolder: () => state.holders[state.holders.length - 1] ?? null,
        anchorHolder: () => state.holders[1] ?? null,
        t: (key) => (key === 'tools.code.plainText' ? 'Texte brut' : key),
      });

      state.preview = preview;
      preview.update('c1', markdown('> [!NOTE]\n> ```\n> x\n> ```'));
      vi.advanceTimersByTime(35 * 10);

      expect(state.layer.querySelector('[data-blok-testid="code-language-name"]')?.textContent).toBe('Texte brut');
    });
  });
});
