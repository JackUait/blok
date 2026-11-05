// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Dom } from '../../../src/components/dom';

type IteratorNext = () => IteratorResult<unknown>;

const arrayIteratorPrototype = Object.getPrototypeOf([][Symbol.iterator]()) as { next: IteratorNext };

/** Array iterator steps taken while `run` executes. Spreads count, element by element. */
const iteratorStepsDuring = (run: () => void): number => {
  const original = arrayIteratorPrototype.next;
  const steps = { count: 0 };

  arrayIteratorPrototype.next = function (this: unknown): IteratorResult<unknown> {
    steps.count++;

    return original.call(this);
  };

  try {
    run();
  } finally {
    arrayIteratorPrototype.next = original;
  }

  return steps.count;
};

const holderWith = (inputs: number, markup: string): HTMLElement => {
  const holder = document.createElement('div');

  holder.innerHTML = Array.from({ length: inputs }, () => markup).join('');
  document.body.appendChild(holder);

  return holder;
};

describe('Dom.findAllInputs cost', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('grows linearly with the number of inputs (a table holds thousands)', () => {
    const stepsFor = (inputs: number): number => {
      const holder = holderWith(inputs, '<div contenteditable="true">x</div>');
      const steps = iteratorStepsDuring(() => Dom.findAllInputs(holder));

      holder.remove();

      return steps;
    };

    expect(stepsFor(4000)).toBeLessThan(stepsFor(2000) * 2.5);
  });

  it('grows linearly for inputs that hold block elements', () => {
    const stepsFor = (inputs: number): number => {
      const holder = holderWith(inputs, '<div contenteditable="true"><p>a</p><p>b</p></div>');
      const steps = iteratorStepsDuring(() => Dom.findAllInputs(holder));

      holder.remove();

      return steps;
    };

    expect(stepsFor(4000)).toBeLessThan(stepsFor(2000) * 2.5);
  });

  it('keeps document order, with nested block elements in place of their input', () => {
    const holder = document.createElement('div');

    holder.innerHTML = '<div contenteditable="true" id="a">x</div><div contenteditable="true"><p id="b">b</p><p id="c">c</p></div><input id="d">';

    expect(Dom.findAllInputs(holder).map((element) => element.id)).toEqual(['a', 'b', 'c', 'd']);
  });
});
