import type { Grader, Verdict } from '../types';
import { inOrder, plainText } from './text';

const ok = (detail: string): Verdict => ({ pass: true, detail });
const no = (detail: string): Verdict => ({ pass: false, detail });

export const MARKDOWN_FINGERPRINTS: Array<[string, RegExp]> = [
  ['**bold**', /\*\*[^*\n]+\*\*/],
  ['__bold__', /__[^_\n]+__/],
  ['`code`', /`[^`\n]+`/],
  ['# heading', /(^|\n)#{1,6} /],
  ['- or * bullet', /(^|\n)[-*] /],
  ['1. item', /(^|\n)\d+\. /],
  ['> quote', /(^|\n)> /],
  ['|---| table row', /\|\s*:?-{3,}/],
  ['``` fence', /```/],
  ['[text](url)', /\[[^\]\n]+\]\([^)\s]+\)/],
];

const residueIn = (text: string, allow: RegExp[]): string[] =>
  MARKDOWN_FINGERPRINTS.filter(([, pattern]) => pattern.test(text) && !allow.some((a) => a.test(text))).map(([label]) => label);

export const noMarkdownResidue = (allow: RegExp[] = []): Grader => ({
  name: 'noMarkdownResidue',
  check: ({ final, results }) => {
    const found = inOrder(final).flatMap((b) => residueIn(plainText(b), allow).map((label) => `${b.id ?? '?'}: ${label}`));
    const warned = (results ?? []).flatMap((r) => r.warnings ?? []).filter((w) => w.code === 'LOOKS_LIKE_MARKDOWN' && w.blockId !== undefined);
    const ignored = warned
      .map((w) => final.blocks.find((b) => b.id === w.blockId))
      .filter((b) => b !== undefined && residueIn(plainText(b), []).length > 0)
      .map((b) => `${b?.id ?? '?'}: LOOKS_LIKE_MARKDOWN warning not acted on`);
    const problems = [...found, ...ignored];

    return problems.length === 0 ? ok('no Markdown residue') : no(problems.join('; '));
  },
});

export const logClean = (maxFailedBatches = 2): Grader => ({
  name: 'logClean',
  check: ({ log }) => {
    if (log.length === 0) {
      return ok('no commands run');
    }

    const lastBatch = Math.max(...log.map((e) => e.batch));
    const failed = new Set(log.filter((e) => e.error !== undefined).map((e) => e.batch));

    if (failed.has(lastBatch)) {
      return no('the last batch failed');
    }

    return failed.size <= maxFailedBatches ? ok(`${failed.size} failed batch(es)`) : no(`${failed.size} failed batches, cap ${maxFailedBatches}`);
  },
});

export const usedAction = (command: string): Grader => ({
  name: `usedAction:${command}`,
  check: ({ log }) => (log.some((e) => e.name === command && e.error === undefined) ? ok(`${command} used`) : no(`${command} never succeeded`)),
});

// An aside ("p is a paragraph, not a heading") names an id only to rule it out, so a clause with a negation
// names no answer. Clauses end at a line, ; ( ) or a sentence end. Quoted block text is dropped first so
// a heading that reads "No budget" is not a negation.
const CLAUSE_CUT = /\n|;|\(|\)|[.!?](?=\s+[A-Z(`*"-]|\s*$)/;
const NEGATION = /\b(?:not|no|none|neither|nor|never|without|except)\b|n't\b/i;

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const answerIds = (expected: string[]): Grader => ({
  name: 'answerIds',
  check: ({ seed, answer }) => {
    const ids = seed.blocks.map((b) => b.id).filter((id): id is string => id !== undefined);
    const given = (answer ?? '').split(CLAUSE_CUT).filter((clause) => !NEGATION.test(clause.replace(/"[^"]*"|“[^”]*”/g, '')));
    const named = ids.filter((id) => given.some((clause) => new RegExp(`\\b${escapeRe(id)}\\b`).test(clause))).sort();
    const want = [...expected].sort();

    return JSON.stringify(named) === JSON.stringify(want) ? ok(named.join(', ')) : no(`named ${named.join(', ') || 'nothing'}, expected ${want.join(', ')}`);
  },
});

export const pageFields = (expected: { title?: string; icon?: unknown }): Grader => ({
  name: 'pageFields',
  check: ({ final }) => {
    // Flat OutputData.title / .icon (01 D-1).
    const page: Record<string, unknown> = { title: final.title, icon: final.icon };
    const wrong = Object.entries(expected).filter(([k, v]) => JSON.stringify(page[k]) !== JSON.stringify(v)).map(([k]) => k);

    return wrong.length === 0 ? ok('page fields match') : no(`wrong: ${wrong.join(', ')} (page = ${JSON.stringify(page)})`);
  },
});

export const toolSequence = (names: string[]): Grader => ({
  name: `toolSequence:${names.join('>')}`,
  check: ({ toolCalls }) => {
    let at = 0;

    for (const call of toolCalls ?? []) {
      if (call === names[at]) {
        at++;
      }
    }

    return at === names.length ? ok('tool order kept') : no(`saw ${(toolCalls ?? []).join(' > ')}`);
  },
});
