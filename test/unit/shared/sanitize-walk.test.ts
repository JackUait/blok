// @vitest-environment node
import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  cloneSanitizerConfig,
  getEffectiveRuleForString,
  isPlaintextRule,
  isRule,
  MAX_SANITIZE_DEPTH,
  walkSanitize,
  wrapFunctionRule,
  type DeepData,
  type DeepSanitizerRule,
  type StringCleaner,
} from '../../../src/shared/sanitize-walk';
import { PLAINTEXT } from '../../../src/shared/sanitize-rules';
import type { SanitizerConfig } from '../../../types';

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('walkSanitize', () => {
  it('gives each field its own rule and falls back to the parent rule', () => {
    const rules = { text: { b: true }, items: false };
    const globalRules = { i: true };
    const seen: Array<[string, DeepSanitizerRule, SanitizerConfig]> = [];
    const clean: StringCleaner = (value, rule, globals) => {
      seen.push([value, rule, globals]);

      return value.toUpperCase();
    };

    expect(walkSanitize({ text: 'a', caption: 'b', items: ['c'] }, rules, globalRules, clean))
      .toEqual({ text: 'A', caption: 'B', items: ['C'] });
    expect(seen).toEqual([
      ['a', rules.text, globalRules],
      ['b', rules, globalRules],
      ['c', false, globalRules],
    ]);
    expect(seen.every(([, , globals]) => globals === globalRules)).toBe(true);
  });

  it('passes plaintext and function field rules to the cleaner without interpreting them', () => {
    const functionRule = () => ({ title: true });
    const rules: SanitizerConfig = { code: PLAINTEXT, text: functionRule, caption: true };
    const clean = vi.fn<StringCleaner>(value => value);

    walkSanitize({ code: '<source>', text: 'text', caption: 'caption' }, rules, {}, clean);

    expect(clean.mock.calls).toEqual([
      ['<source>', PLAINTEXT, {}],
      ['text', functionRule, {}],
      ['caption', true, {}],
    ]);
  });

  it('keeps non-string fields and rebuilds nested containers without mutating them', () => {
    const input = { items: ['a', { text: 'b', count: 2, enabled: false, empty: null, missing: undefined }], count: 0 };
    const output = walkSanitize(input, {}, {}, value => value.toUpperCase());

    expect(output).toEqual({ items: ['A', { text: 'B', count: 2, enabled: false, empty: null, missing: undefined }], count: 0 });
    expect(output).not.toBe(input);
    expect(input.items).toEqual(['a', { text: 'b', count: 2, enabled: false, empty: null, missing: undefined }]);
    if (output === null || typeof output !== 'object' || Array.isArray(output)) {
      throw new Error('Expected object output');
    }
    expect(output.items).not.toBe(input.items);
  });

  it('omits inherited fields but uses inherited field rules', () => {
    const input: Record<string, unknown> = { own: 'a' };
    const rules: SanitizerConfig = {};

    Object.defineProperty(Object.prototype, 'sanitizeWalkInherited', { configurable: true, enumerable: true, value: 'inherited' });
    Object.defineProperty(Object.prototype, 'own', { configurable: true, writable: true, value: false });
    const clean = vi.fn<StringCleaner>(value => value);
    let output: DeepData = null;

    try {
      output = walkSanitize(input, rules, {}, clean);
    } finally {
      Reflect.deleteProperty(Object.prototype, 'sanitizeWalkInherited');
      Reflect.deleteProperty(Object.prototype, 'own');
    }
    expect(output).toEqual({ own: 'a' });
    expect(clean.mock.calls).toEqual([['a', false, {}]]);
  });

  it('cleans null-prototype objects', () => {
    const input: Record<string, unknown> = { text: 'a' };

    Object.setPrototypeOf(input, null);

    expect(walkSanitize(input, {}, {}, value => value.toUpperCase())).toEqual({ text: 'A' });
  });

  it('cleans a string at the cap but replaces every value beyond it with null', () => {
    const clean = vi.fn<StringCleaner>(value => value.toUpperCase());

    expect(walkSanitize('x', {}, {}, clean, MAX_SANITIZE_DEPTH)).toBe('X');
    expect(walkSanitize('x', {}, {}, clean, MAX_SANITIZE_DEPTH + 1)).toBeNull();
    expect(walkSanitize({ count: 1, text: 'x' }, {}, {}, clean, MAX_SANITIZE_DEPTH)).toEqual({ count: null, text: null });
    expect(clean).toHaveBeenCalledTimes(1);
    expect(MAX_SANITIZE_DEPTH).toBe(256);
  });

  it('truncates deeply nested arrays', () => {
    let input: DeepData = 'x';
    let expected: DeepData = null;

    for (let i = 0; i < MAX_SANITIZE_DEPTH + 1; i++) {
      input = [input];
      expected = [expected];
    }
    const clean = vi.fn<StringCleaner>(value => value);

    expect(walkSanitize(input, {}, {}, clean)).toEqual(expected);
    expect(clean).not.toHaveBeenCalled();
  });

  it('preserves sparse array slots', () => {
    const input: DeepData[] = [];

    input[2] = 'a';
    const output = walkSanitize(input, {}, {}, value => value.toUpperCase());

    const expected: DeepData[] = [];

    expected[2] = 'A';
    expect(output).toEqual(expected);
    expect(Array.isArray(output) && Object.hasOwn(output, 0)).toBe(false);
  });
});

describe('sanitizer rules', () => {
  it('recognizes the existing rule kinds and the plaintext sentinel', () => {
    const rules: DeepSanitizerRule[] = [{}, true, false, () => ({}), PLAINTEXT];

    expect(rules.every(isRule)).toBe(true);
    expect(isPlaintextRule(PLAINTEXT)).toBe(true);
    expect(isPlaintextRule({ text: PLAINTEXT })).toBe(false);
  });

  it('disables tag allowlisting with false and falls back to global rules otherwise', () => {
    expect(getEffectiveRuleForString(false, { i: {} })).toEqual({});
    expect(getEffectiveRuleForString(true, {})).toBeNull();
    expect(getEffectiveRuleForString(() => ({}), {})).toBeNull();
    expect(getEffectiveRuleForString(true, { i: {} })).toEqual({ i: {} });
  });

  it('merges tag attributes with global overrides and keeps field-only tags', () => {
    const fieldRules = { a: { href: true, target: '_self' }, b: {} };
    const globalRules = { a: { target: '_blank', rel: 'nofollow' }, i: {} };

    expect(getEffectiveRuleForString(fieldRules, globalRules)).toEqual({
      a: { href: true, target: '_blank', rel: 'nofollow' },
      i: {},
      b: {},
    });
    expect(fieldRules.a).toEqual({ href: true, target: '_self' });
    expect(globalRules.a).toEqual({ target: '_blank', rel: 'nofollow' });
  });

  it('clones attribute configs instead of retaining references', () => {
    const original: SanitizerConfig = { a: { href: true } };
    const cloned = cloneSanitizerConfig(original);

    expect(cloned).toEqual(original);
    expect(cloned).not.toBe(original);
    expect(cloned.a).not.toBe(original.a);
  });

  it('wraps true tag rules to keep safe attributes only', () => {
    const dom = new JSDOM('<span class="kept" id="id" title="hint" role="note" dir="rtl" lang="en" data-id="1" aria-label="label" style="color:red" onclick="bad()" href="bad">text</span>');
    const element = dom.window.document.querySelector('span');
    const effective = getEffectiveRuleForString({ span: true }, {});
    const rule = effective?.span;

    try {
      if (element === null || typeof rule !== 'function') {
        throw new Error('Expected a preserving function and an element');
      }
      expect(rule(element)).toEqual({ class: true, id: true, title: true, role: true, dir: true, lang: true, 'data-id': true, 'aria-label': true });
    } finally {
      dom.window.close();
    }
  });

  it('chooses a field function over a global function but not a global non-function rule', () => {
    const dom = new JSDOM('<span></span>');
    const element = dom.window.document.querySelector('span');
    const fieldRule = () => ({ title: 'field' });
    const globalRule = () => ({ title: 'global' });
    const chosen = getEffectiveRuleForString({ span: fieldRule }, { span: globalRule })?.span;

    try {
      if (element === null || typeof chosen !== 'function') {
        throw new Error('Expected function rule and element');
      }
      expect(chosen(element)).toEqual({ title: 'field' });
      expect(getEffectiveRuleForString({ span: fieldRule }, { span: false })).toEqual({ span: false });
    } finally {
      dom.window.close();
    }
  });

  it('chooses the global function over a field attribute rule', () => {
    const dom = new JSDOM('<span></span>');
    const element = dom.window.document.querySelector('span');
    const rule = getEffectiveRuleForString({ span: { title: 'field' } }, { span: () => ({ title: 'global' }) })?.span;

    try {
      if (element === null || typeof rule !== 'function') {
        throw new Error('Expected function rule and element');
      }
      expect(rule(element)).toEqual({ title: 'global' });
    } finally {
      dom.window.close();
    }
  });

  it('preserves the function receiver and element when wrapping a rule', () => {
    const dom = new JSDOM('<span></span>');
    const element = dom.window.document.querySelector('span');
    const receiver = { title: 'context' };
    let seen: Element | null = null;
    const rule = function (this: typeof receiver, input: Element) {
      seen = input;

      return { title: this.title, id: input.tagName };
    };

    try {
      if (element === null) {
        throw new Error('Expected element');
      }
      expect(wrapFunctionRule(rule).call(receiver, element)).toEqual({ title: 'context', id: 'SPAN' });
      expect(seen).toBe(element);
    } finally {
      dom.window.close();
    }
  });
});
