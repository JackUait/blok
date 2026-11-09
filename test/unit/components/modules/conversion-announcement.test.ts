import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import Blok from '../../../../src/blok';
import { Paragraph } from '../../../../src/tools/paragraph';
import { Header } from '../../../../src/tools/header';
import { ListItem } from '../../../../src/tools/list';
import { DividerTool } from '../../../../src/tools/divider';
import { ToggleItem } from '../../../../src/tools/toggle';
import { Quote } from '../../../../src/tools/quote';
import { CodeTool } from '../../../../src/tools/code';
import type { Blok as PublicBlok, OutputBlockData } from '../../../../types';

/**
 * A markdown shortcut that converts a block says so in the polite live region,
 * like Notion: "Converted to Heading 2". The name is the one the convert menu shows.
 */
describe('markdown shortcut conversion announcements', () => {
  // jsdom keeps contentEditable as a plain property; core finds inputs by the attribute, as in a browser.
  const reflected = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'contentEditable');

  beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, 'contentEditable', {
      configurable: true,
      get(this: HTMLElement): string {
        return this.getAttribute('contenteditable') ?? 'inherit';
      },
      set(this: HTMLElement, value: string) {
        this.setAttribute('contenteditable', String(value));
      },
    });
  });

  afterAll(() => {
    if (reflected !== undefined) {
      Object.defineProperty(HTMLElement.prototype, 'contentEditable', reflected);
    }
  });

  let holder: HTMLDivElement;
  let blok: PublicBlok | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    blok?.destroy();
    blok = null;
    holder.remove();
    vi.restoreAllMocks();
  });

  const boot = async (): Promise<PublicBlok> => {
    const booted = new Blok({
      holder,
      tools: {
        paragraph: { class: Paragraph },
        header: { class: Header },
        list: { class: ListItem },
        divider: { class: DividerTool },
        toggle: { class: ToggleItem },
        quote: { class: Quote },
        code: { class: CodeTool },
      },
      data: { blocks: [{ id: 'p1', type: 'paragraph', data: { text: '' } }] },
    }) as unknown as PublicBlok;

    blok = booted;
    await booted.isReady;
    booted.history.clear();
    // Block DOM listeners bind on idle.
    await vi.waitFor(() => new Promise<void>((resolve) => { window.requestIdleCallback(() => resolve()); }));

    return booted;
  };

  /** The region writes on the next macrotask; read it after that. */
  const announced = async (): Promise<string> => {
    await new Promise((resolve) => setTimeout(resolve, 20));

    const region = document.getElementById('blok-announcer');

    if (region === null) {
      throw new Error('no live region');
    }

    return region.textContent;
  };

  const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 200));

  const editable = (): HTMLElement => {
    const found = holder.querySelector('[data-blok-tool="paragraph"]');

    if (!(found instanceof HTMLElement)) {
      throw new Error('no paragraph');
    }

    return found;
  };

  /** Puts `text` in the paragraph with the caret at its end, then fires the last key's input event. */
  const type = (text: string): void => {
    const input = editable();

    input.textContent = text;
    const range = document.createRange();

    range.selectNodeContents(input);
    range.collapse(false);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    // jsdom does not focus a contenteditable, and the block learns its current input from this event.
    input.dispatchEvent(new FocusEvent('focus'));
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text.slice(-1) }));
  };

  const firstBlock = async (booted: PublicBlok): Promise<OutputBlockData | undefined> => (await booted.save()).blocks[0];

  it.each([
    ['## ', 'Converted to Heading 2'],
    ['# ', 'Converted to Heading 1'],
    ['[] ', 'Converted to To-do list'],
    ['- ', 'Converted to Bulleted list'],
    ['---', 'Converted to Divider'],
    ['>## ', 'Converted to Toggle heading 2'],
    ['1. ', 'Converted to Numbered list'],
    ['> ', 'Converted to Toggle list'],
    ['" ', 'Converted to Quote'],
    ['```', 'Converted to Code'],
  ])('typing %j says %j', async (text, message) => {
    await boot();

    type(text);

    expect(await announced()).toBe(message);
  });

  it('says nothing when the text is not a shortcut', async () => {
    await boot();

    type('hi ');

    expect(await announced()).toBe('');
  });

  it('an undo of the conversion says only Undone and leaves no heading', async () => {
    const booted = await boot();

    type('## ');
    await vi.waitFor(async () => expect((await firstBlock(booted))?.type).toBe('header'));
    await settle();

    const region = document.getElementById('blok-announcer');

    if (region === null) {
      throw new Error('no live region');
    }
    const written: string[] = [];
    const observer = new MutationObserver(() => {
      if (region.textContent !== '') {
        written.push(region.textContent);
      }
    });

    observer.observe(region, { childList: true, characterData: true, subtree: true });
    holder.querySelector('[data-blok-tool="header"]')?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true, cancelable: true })
    );
    await settle();
    observer.disconnect();

    expect(written).toEqual(['Undone']);
    expect((await firstBlock(booted))?.type).not.toBe('header');
  });
});
