import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { OutputData } from '../../../types';
import { answerIds, logClean, noMarkdownResidue, pageFields, toolSequence, usedAction } from '../../evals/agent/graders/behaviour';
import type { GraderInput, LogEntry } from '../../evals/agent/types';

const one = (text: unknown): OutputData => ({ blocks: [{ id: 'p', type: 'paragraph', data: { text } }] });
const base = (final: OutputData, extra: Partial<GraderInput> = {}): GraderInput => ({ seed: { blocks: [] }, final, actorId: 'agent', log: [], ...extra });
const entry = (batch: number, name: string, error?: string): LogEntry => ({ batch, index: 0, name, args: {}, actorId: 'agent', ...(error === undefined ? {} : { error: { code: error } }) });

describe('behaviour graders', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('noMarkdownResidue rejects the original failure: Markdown written into one paragraph', () => {
    expect(noMarkdownResidue().check(base(one([{ text: '## Plan\n**intro**\n- a\n- b' }]))).pass).toBe(false);
  });

  it.each([
    ['bold', '**x**'], ['underscore bold', '__x__'], ['code', 'use `npm`'], ['heading', '# Title'], ['bullet', '- item'],
    ['ordered', '1. first'], ['quote', '> said'], ['table', '| a | b |\n|---|---|'], ['fence', '```js'], ['link', '[docs](https://x.y)'],
  ])('noMarkdownResidue catches %s', (_label, residue) => {
    expect(noMarkdownResidue().check(base(one([{ text: residue }]))).pass).toBe(false);
  });

  it('noMarkdownResidue passes real marks and honours an allow-list', () => {
    expect(noMarkdownResidue().check(base(one([{ text: 'intro', marks: { bold: true } }]))).pass).toBe(true);
    expect(noMarkdownResidue([/- item/]).check(base(one([{ text: '- item' }]))).pass).toBe(true);
  });

  it('noMarkdownResidue fails an unanswered LOOKS_LIKE_MARKDOWN warning', () => {
    const results = [{ ok: true, warnings: [{ code: 'LOOKS_LIKE_MARKDOWN', blockId: 'p' }] }];

    expect(noMarkdownResidue([/\*\*/]).check(base(one([{ text: '**x**' }]), { results })).pass).toBe(false);
  });

  it('logClean: the last batch must succeed and failures stay under the cap', () => {
    expect(logClean(1).check(base(one([]), { log: [entry(0, 'block.insert', 'INVALID_ARGS'), entry(1, 'block.insert')] })).pass).toBe(true);
    expect(logClean(1).check(base(one([]), { log: [entry(0, 'x', 'A'), entry(1, 'x', 'B'), entry(2, 'x')] })).pass).toBe(false);
    expect(logClean(2).check(base(one([]), { log: [entry(0, 'x'), entry(1, 'x', 'B')] })).pass).toBe(false);
  });

  it('usedAction needs a successful call of that command', () => {
    expect(usedAction('table.mergeCells').check(base(one([]), { log: [entry(0, 'table.mergeCells')] })).pass).toBe(true);
    expect(usedAction('table.mergeCells').check(base(one([]), { log: [entry(0, 'block.update')] })).pass).toBe(false);
    expect(usedAction('table.mergeCells').check(base(one([]), { log: [entry(0, 'table.mergeCells', 'PRECONDITION_FAILED')] })).pass).toBe(false);
  });

  it('answerIds compares the set of seed ids named in the answer', () => {
    const seed: OutputData = { blocks: [{ id: 'h1', type: 'header', data: {} }, { id: 'h2', type: 'header', data: {} }, { id: 'h3', type: 'header', data: {} }] };

    expect(answerIds(['h1', 'h3']).check({ ...base(seed), seed, answer: 'They are h3 and h1.' }).pass).toBe(true);
    expect(answerIds(['h1', 'h3']).check({ ...base(seed), seed, answer: 'h1, h2, h3' }).pass).toBe(false);
  });

  describe('answerIds with asides', () => {
    const seed: OutputData = {
      blocks: [{ id: 'h1', type: 'header', data: {} }, { id: 'h2', type: 'header', data: {} }, { id: 'h3', type: 'header', data: {} }, { id: 'p', type: 'paragraph', data: {} }],
    };
    const grade = (answer: string): boolean => answerIds(['h1', 'h3']).check({ ...base(seed), seed, answer }).pass;

    // Real deepseek-flash answers (eval-tools/runs/answer/1): correct, with an aside ruling the other ids out.
    it.each([
      'Two headings mention "budget":\n\n- **`h1`** — "Budget 2026"\n- **`h3`** — "Marketing budget"\n\n(`p` — "The budget is tight." — also contains the word but is a paragraph, not a heading; `h2` "Hiring" has no mention.)',
      'Two headings mention "budget":\n\n- `h1` — "Budget 2026"\n- `h3` — "Marketing budget"\n\n(The paragraph `p`, "The budget is tight.", also contains the word but isn\'t a heading.)',
    ])('does not count an id the answer rules out: %s', (answer) => {
      expect(grade(answer)).toBe(true);
    });

    it.each(['h1, h3 and p', 'h1, h3 (and p)', 'h1, h3. Also p.'])('still counts an extra id given as an answer: %s', (answer) => {
      expect(grade(answer)).toBe(false);
    });
  });

  it('pageFields compares the saved page field', () => {
    const final = { blocks: [], title: 'Q3 plan', icon: { type: 'emoji', value: '📅' } } as OutputData;

    expect(pageFields({ title: 'Q3 plan', icon: { type: 'emoji', value: '📅' } }).check(base(final)).pass).toBe(true);
    expect(pageFields({ title: 'Q4' }).check(base(final)).pass).toBe(false);
  });

  it('toolSequence needs the names in order, gaps allowed', () => {
    const toolCalls = ['blok_list_documents', 'blok_open', 'blok_read', 'blok_execute', 'blok_close'];

    expect(toolSequence(['blok_open', 'blok_execute', 'blok_close']).check(base(one([]), { toolCalls })).pass).toBe(true);
    expect(toolSequence(['blok_execute', 'blok_open']).check(base(one([]), { toolCalls })).pass).toBe(false);
  });
});
