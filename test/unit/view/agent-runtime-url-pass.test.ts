// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createHeadlessPorts } from '../../../src/view/agent-runtime';

import type { ToolSanitizerConfig } from '../../../types/configs/sanitizer-config';

/**
 * The headless URL pass runs on client text in Blok.Server (Jint) and the MCP
 * server (Node), so it must stay linear. The budget is wide for slow CI.
 */
const BUDGET_MS = 500;
const RUN = 50_000;

const portsWith = (rules: ToolSanitizerConfig | undefined): ReturnType<typeof createHeadlessPorts> => createHeadlessPorts({
  sanitizeFor: () => rules,
  richTextFieldsFor: () => [],
});

const urlsOnly = (text: string): unknown => portsWith(undefined).sanitizeBlockData('custom', { text }).text;
const trueRule = (text: string): unknown => portsWith({ text: true }).sanitizeBlockData('custom', { text }).text;

const timed = (run: () => unknown): number => {
  const start = performance.now();

  run();

  return performance.now() - start;
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('headless URL pass', () => {
  it.each([
    [ 'a bare <', `<${'\t'.repeat(RUN)}` ],
    [ 'an open tag', `<a ${'\t'.repeat(RUN)}` ],
    [ 'an attribute name', `<a href${'\t'.repeat(RUN)}` ],
    [ 'spaces after =', `<a href=${' '.repeat(RUN)}` ],
  ])('stays linear on a long whitespace run after %s', (_name, input) => {
    expect(timed(() => urlsOnly(input))).toBeLessThan(BUDGET_MS);
    expect(timed(() => trueRule(input))).toBeLessThan(BUDGET_MS);
  });

  it.each([
    [ '<a href="javascript:alert(1)">x</a>', '<a>x</a>' ],
    [ '<a href = \'javascript:alert(1)\' title="t">x</a>', '<a title="t">x</a>' ],
    [ '<img src=data:text/html,x alt="a">', '<img alt="a">' ],
    [ '<a HREF="JaVaScRiPt:alert(1)">x</a>', '<a>x</a>' ],
    [ '<svg><a xlink:href="javascript:alert(1)">x</a></svg>', '<svg><a>x</a></svg>' ],
    [ '<template><a href="javascript:alert(1)">x</a></template>', '<template><a>x</a></template>' ],
    [ '<a href="javascript&colon;alert(1)">x</a>', '<a>x</a>' ],
    [ '<a href="&#106;avascript:alert(1)">x</a>', '<a>x</a>' ],
    [ '<a href=javascript&#58;alert(1)>x</a>', '<a>x</a>' ],
  ])('removes an unsafe URL from %s', (input, expected) => {
    expect(urlsOnly(input)).toBe(expected);
    expect(trueRule(input)).toBe(expected);
  });

  it.each([
    'a < b & c </tag> <b>x</b>',
    '<a href="https://example.com">x</a>&nbsp;',
    '<img src="data:image/png;base64,AAAA">',
  ])('returns %s byte for byte when nothing is unsafe', (input) => {
    expect(urlsOnly(input)).toBe(input);
    expect(trueRule(input)).toBe(input);
  });

  it('keeps text that only looks like a URL attribute', () => {
    const input = '<p>set src=javascript:x in the config</p>';

    expect(urlsOnly(input)).toBe(input);
    expect(trueRule(input)).toBe(input);
  });
});
