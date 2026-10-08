import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  contractToDomOffset,
  inputIndexForField,
  placeAgent,
} from '../../../../../src/components/modules/collaboration/agent-placement';
import type { AgentTarget, PlacementDeps } from '../../../../../src/components/modules/collaboration/agent-placement';
import { measureSelection, resolveCaretRange } from '../../../../../src/components/modules/collaboration/caret-position';

const mounted: HTMLElement[] = [];

const inputWith = (html: string): HTMLElement => {
  const input = document.createElement('div');

  input.setAttribute('contenteditable', 'true');
  input.innerHTML = html;
  document.body.appendChild(input);
  mounted.push(input);

  return input;
};

const depsFor = (inputs: HTMLElement[], index: number | null): PlacementDeps => ({
  resolveInputs: () => inputs,
  inputIndexFor: () => index,
});

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  window.getSelection()?.removeAllRanges();
  mounted.forEach((input) => input.remove());
  mounted.length = 0;
  vi.restoreAllMocks();
});

describe('inputIndexForField', () => {
  it('maps a field through the declared DOM input order', () => {
    expect(inputIndexForField('caption', { inputFields: ['text', 'caption'], richTextFields: ['caption', 'text'] })).toBe(1);
  });

  it('maps the only rich field to the first input when no input order is declared', () => {
    expect(inputIndexForField('text', { richTextFields: ['text'] })).toBe(0);
  });

  it.each([
    ['ambiguous rich fields', 'a', { richTextFields: ['a', 'b'] }],
    ['a field absent from the declared inputs', 'caption', { inputFields: ['text'], richTextFields: ['text', 'caption'] }],
    ['an explicitly empty input order', 'text', { inputFields: [], richTextFields: ['text'] }],
    ['a different field', 'caption', { richTextFields: ['text'] }],
    ['no rich fields', 'text', { richTextFields: [] }],
    ['an unknown tool', 'text', undefined],
  ] as const)('does not guess an input for %s', (_label, field, entry) => {
    const mutableEntry = entry === undefined ? undefined : {
      richTextFields: [...entry.richTextFields],
      ...('inputFields' in entry ? { inputFields: [...entry.inputFields] } : {}),
    };

    expect(inputIndexForField(field, mutableEntry)).toBeNull();
  });
});

describe('contractToDomOffset', () => {
  it('keeps plain-text offsets', () => {
    expect(contractToDomOffset(inputWith('hello'), 3)).toBe(3);
  });

  it('counts a supplementary character as two UTF-16 units', () => {
    expect(contractToDomOffset(inputWith('a😀b'), 3)).toBe(3);
  });

  it('uses the rendered equation text length, not the source attribute', () => {
    const input = inputWith('ab<span data-latex="x^2"><span>x2</span><span>x^2</span><span>x2</span></span>cd');

    expect(contractToDomOffset(input, 4)).toBe(10);
  });

  it('maps before and after an equation without entering its rendered text', () => {
    const input = inputWith('ab<span data-latex="x^2">x^2</span>cd');

    expect(contractToDomOffset(input, 2)).toBe(2);
    expect(contractToDomOffset(input, 3)).toBe(5);
  });

  it('counts a page mention as one contract unit and its label as DOM text', () => {
    const input = inputWith('a<a data-blok-page-id="p9">Untitled</a>b');

    expect(contractToDomOffset(input, 2)).toBe(9);
    expect(contractToDomOffset(input, 3)).toBe(10);
  });

  it('keeps ordinary links transparent', () => {
    expect(contractToDomOffset(inputWith('a<a href="/page">hello</a>b'), 4)).toBe(4);
  });

  it('counts a line break as one contract unit and no DOM characters', () => {
    const input = inputWith('ab<br>cd');

    expect(contractToDomOffset(input, 3)).toBe(2);
    expect(contractToDomOffset(input, 4)).toBe(3);
  });

  it('counts consecutive line breaks separately', () => {
    expect(contractToDomOffset(inputWith('a<br><br>b'), 4)).toBe(2);
  });

  it('walks through nested marks', () => {
    expect(contractToDomOffset(inputWith('a<b>b<i>c</i></b>d'), 3)).toBe(3);
  });

  it.each([
    ['image', '<img src="x.png">', 2],
    ['input', '<input value="hidden">', 2],
    ['word-break opportunity', '<wbr>', 2],
    ['picture', '<picture><img src="x.png"></picture>', 2],
    ['opaque block', '<div>long<br>label</div>', 11],
    ['math', '<math><mi>x</mi><mn>2</mn></math>', 4],
  ] as const)('counts an %s embed once without walking its contents', (_label, html, expected) => {
    expect(contractToDomOffset(inputWith(`a${html}b`), 3)).toBe(expected);
  });

  it('stops before a textless embed at a zero offset', () => {
    expect(contractToDomOffset(inputWith('<img src="x.png">tail'), 0)).toBe(0);
  });

  it('clamps a negative offset to the beginning', () => {
    expect(contractToDomOffset(inputWith('<span data-latex="x">x</span>tail'), -1)).toBe(0);
  });

  it('clamps past the end to the DOM text length', () => {
    expect(contractToDomOffset(inputWith('ab<br>cd'), 99)).toBe(4);
  });

  it('returns zero for an empty input', () => {
    expect(contractToDomOffset(inputWith(''), 3)).toBe(0);
  });
});

describe('placeAgent', () => {
  it('maps the named field to its own input and converts both offsets', () => {
    const first = inputWith('wrong input');
    const second = inputWith('ab<span data-latex="x^2">x^2</span>cd');

    expect(placeAgent({ blockId: 'b1', field: 'caption', start: 3, end: 4 }, depsFor([first, second], 1))).toEqual({
      kind: 'caret',
      caret: { blockId: 'b1', inputIndex: 1, anchor: 5, head: 6 },
    });
  });

  it('preserves a backwards range', () => {
    expect(placeAgent({ blockId: 'b1', field: 'text', start: 4, end: 1 }, depsFor([inputWith('a<br>bcd')], 0))).toEqual({
      kind: 'caret',
      caret: { blockId: 'b1', inputIndex: 0, anchor: 3, head: 1 },
    });
  });

  it.each([
    ['no field', { blockId: 'b1' }],
    ['a null field', { blockId: 'b1', field: null, start: 0, end: 0 }],
    ['no offsets', { blockId: 'b1', field: 'text' }],
    ['a missing start', { blockId: 'b1', field: 'text', end: 0 }],
    ['a null end', { blockId: 'b1', field: 'text', start: 0, end: null }],
  ] satisfies Array<[string, AgentTarget]>)('uses a block marker with %s', (_label, target) => {
    expect(placeAgent(target, depsFor([inputWith('x')], 0))).toEqual({ kind: 'block', blockId: 'b1' });
  });

  it('uses a block marker when the field has no input mapping', () => {
    expect(placeAgent({ blockId: 'b1', field: 'text', start: 0, end: 1 }, depsFor([inputWith('x')], null))).toEqual({ kind: 'block', blockId: 'b1' });
  });

  it('uses a block marker when the mapped input is missing', () => {
    expect(placeAgent({ blockId: 'b1', field: 'text', start: 0, end: 1 }, depsFor([], 0))).toEqual({ kind: 'block', blockId: 'b1' });
  });

  it.each(['input', 'textarea'] as const)('uses a block marker for a native %s', (tag) => {
    const native = document.createElement(tag);

    expect(placeAgent({ blockId: 'b1', field: 'text', start: 0, end: 1 }, depsFor([native], 0))).toEqual({ kind: 'block', blockId: 'b1' });
  });

  it('returns offsets that resolve after the embed in the existing caret pipeline', () => {
    const input = inputWith('ab<span data-latex="x^2">x^2</span>cd');
    const placement = placeAgent({ blockId: 'b1', field: 'text', start: 4, end: 4 }, depsFor([input], 0));

    if (placement.kind !== 'caret') {
      throw new Error('Expected a caret placement');
    }

    const range = resolveCaretRange(input, placement.caret.head);

    expect(range?.startContainer).toBe(input.lastChild);
    expect(range?.startOffset).toBe(1);
  });

  it.each([
    ['line break', 'ab<br>cd', 3, 2],
    ['image', 'a<img src="x.png">b', 2, 1],
  ] as const)('uses a block marker when the resolver cannot reach after a %s', (_label, html, endpoint, resolvedOffset) => {
    const input = inputWith(html);
    const placement = placeAgent({ blockId: 'b1', field: 'text', start: endpoint, end: endpoint }, depsFor([input], 0));

    expect(placement).toEqual({ kind: 'block', blockId: 'b1' });

    const range = resolveCaretRange(input, contractToDomOffset(input, endpoint));

    expect(range?.startContainer).toBe(input.firstChild);
    expect(range?.startOffset).toBe(resolvedOffset);
  });

  it('uses a block marker rather than collapsing a selected image in the resolver', () => {
    const input = inputWith('a<img src="x.png">b');
    const placement = placeAgent({ blockId: 'b1', field: 'text', start: 1, end: 2 }, depsFor([input], 0));

    expect(placement).toEqual({ kind: 'block', blockId: 'b1' });

    const anchor = contractToDomOffset(input, 1);
    const head = contractToDomOffset(input, 2);
    const start = resolveCaretRange(input, anchor);
    const end = resolveCaretRange(input, head);

    expect(start?.startContainer).toBe(end?.startContainer);
    expect(start?.startOffset).toBe(end?.startOffset);
    expect(measureSelection(input, anchor, head)).toEqual([]);
  });

  it('uses a block marker when zero resolves after a leading image', () => {
    const input = inputWith('<img src="x.png">tail');
    const placement = placeAgent({ blockId: 'b1', field: 'text', start: 0, end: 0 }, depsFor([input], 0));

    expect(placement).toEqual({ kind: 'block', blockId: 'b1' });

    const range = resolveCaretRange(input, 0);

    expect(range?.startContainer).toBe(input.lastChild);
    expect(range?.startOffset).toBe(0);
  });

  it.each(['a<br>', 'a<img src="x.png">'] as const)('uses a block marker after a trailing zero-text unit in %s', (html) => {
    const input = inputWith(html);
    const placement = placeAgent({ blockId: 'b1', field: 'text', start: 2, end: 2 }, depsFor([input], 0));

    expect(placement).toEqual({ kind: 'block', blockId: 'b1' });

    const range = resolveCaretRange(input, contractToDomOffset(input, 2));

    expect(range?.startContainer).toBe(input.firstChild);
    expect(range?.startOffset).toBe(1);
  });

  it.each(['a<br>bcd', 'a<img src="x.png">bcd'] as const)('keeps representable endpoints around a zero-text unit in %s', (html) => {
    const input = inputWith(html);
    const placement = placeAgent({ blockId: 'b1', field: 'text', start: 1, end: 3 }, depsFor([input], 0));

    expect(placement).toEqual({ kind: 'caret', caret: { blockId: 'b1', inputIndex: 0, anchor: 1, head: 2 } });

    if (placement.kind !== 'caret') {
      throw new Error('Expected a caret placement');
    }

    const start = resolveCaretRange(input, placement.caret.anchor);
    const end = resolveCaretRange(input, placement.caret.head);

    expect(start?.startContainer).toBe(input.firstChild);
    expect(start?.startOffset).toBe(1);
    expect(end?.startContainer).toBe(input.lastChild);
    expect(end?.startOffset).toBe(1);
  });

  it('keeps a representable range covering an equation embed', () => {
    const input = inputWith('ab<span data-latex="x^2"><b>x</b><i>^2</i></span>cd');
    const placement = placeAgent({ blockId: 'b1', field: 'text', start: 2, end: 3 }, depsFor([input], 0));

    expect(placement).toEqual({ kind: 'caret', caret: { blockId: 'b1', inputIndex: 0, anchor: 2, head: 5 } });

    if (placement.kind !== 'caret') {
      throw new Error('Expected a caret placement');
    }

    const end = resolveCaretRange(input, placement.caret.head);
    const equation = input.children.item(0);

    expect(end?.startContainer).toBe(equation?.lastChild?.firstChild);
    expect(end?.startOffset).toBe(2);
  });

  it.each([
    ['<span data-latex="x"><br>x</span>tail', 0],
    ['a<span data-latex="x">x<br></span>b', 2],
    ['a<div>x<img src="x.png"></div>b', 2],
  ] as const)('uses a block marker for an embed edge hidden by zero-text content in %s', (html, endpoint) => {
    const input = inputWith(html);

    expect(placeAgent({ blockId: 'b1', field: 'text', start: endpoint, end: endpoint }, depsFor([input], 0))).toEqual({
      kind: 'block', blockId: 'b1',
    });

    const range = resolveCaretRange(input, contractToDomOffset(input, endpoint));
    const embed = input.children.item(0);

    expect(embed?.contains(range?.startContainer ?? null)).toBe(true);
  });

  it('keeps clamped endpoints when the resolver can reach the input end', () => {
    const input = inputWith('a<br>b');

    expect(placeAgent({ blockId: 'b1', field: 'text', start: -1, end: 99 }, depsFor([input], 0))).toEqual({
      kind: 'caret', caret: { blockId: 'b1', inputIndex: 0, anchor: 0, head: 2 },
    });
  });

  it('does not change the user focus or selection', () => {
    const userInput = inputWith('human typing');
    const text = userInput.firstChild;
    const selection = window.getSelection();

    if (!(text instanceof Text) || selection === null) {
      throw new Error('Expected selectable user text');
    }

    userInput.tabIndex = 0;
    userInput.focus();
    selection.setBaseAndExtent(text, 5, text, 2);
    const agentInput = inputWith('ab<span data-latex="x^2">x^2</span>cd');

    placeAgent({ blockId: 'agent-block', field: 'text', start: 3, end: 4 }, depsFor([agentInput], 0));

    expect(userInput).toHaveFocus();
    expect(selection.anchorNode).toBe(text);
    expect(selection.anchorOffset).toBe(5);
    expect(selection.focusNode).toBe(text);
    expect(selection.focusOffset).toBe(2);
  });
});
