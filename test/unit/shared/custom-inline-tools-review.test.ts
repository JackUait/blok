// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildMcpContracts } from '../../../src/mcp/contract';
import { describeContract } from '../../../src/shared/agent/describe';
import { readCustomToolsFile } from '../../../src/shared/custom-tools-file';

import type { AgentContract, BlokCustomToolsFile } from '../../../types/tool-manifest';

const fileWith = (inlineTools: unknown, extra: Record<string, unknown> = {}): unknown => ({ formatVersion: 1, blocks: [], inlineTools, ...extra });

const contractWith = (inlineTools: BlokCustomToolsFile['inlineTools']): AgentContract =>
  buildMcpContracts({ pageTitles: 'off', manifest: { formatVersion: 1, blocks: [], inlineTools } }).stored;

describe('custom inline tools file: what it refuses', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    ['an event handler attribute', { kbd: { onclick: true } }],
    ['an attribute name with a quote', { kbd: { 'a"b': true } }],
    ['an attribute name with a space', { kbd: { 'a b': true } }],
    ['srcdoc', { kbd: { srcdoc: true } }],
    ['a script tag', { script: true }],
    ['an iframe tag', { iframe: { src: true } }],
    ['a style tag', { style: true }],
    ['an object tag', { object: true }],
    ['an embed tag', { embed: true }],
  ])('refuses %s', (_label, sanitize) => {
    expect(() => readCustomToolsFile(fileWith([{ name: 'kbd', sanitize }]))).toThrow(TypeError);
  });

  it.each([
    ['an svg tag', { svg: true, a: { href: true }, text: true }],
    ['an animate tag', { animate: { attributename: true, to: true } }],
    ['a button with formaction', { button: { formaction: true } }],
    ['a form with action', { form: { action: true } }],
    ['xlink:href', { a: { 'xlink:href': true } }],
    ['a style attribute', { span: { style: true } }],
    ['a cite URL attribute', { q: { cite: true } }],
    ['srcset', { span: { srcset: true } }],
    ['href on a tag that is not a link', { kbd: { href: true } }],
    ['a data-blok-* attribute', { kbd: { 'data-blok-id': true } }],
  ])('refuses %s (allowlist)', (_label, sanitize) => {
    expect(() => readCustomToolsFile(fileWith([{ name: 'kbd', sanitize }]))).toThrow(TypeError);
  });

  it('accepts phrasing tags with plain attributes, and a link with href, target and rel', () => {
    expect(() => readCustomToolsFile(fileWith([
      { name: 'kbd', sanitize: { kbd: { class: true, 'data-key': true, 'aria-label': true, title: true } } },
      { name: 'when', sanitize: { time: { datetime: true } } },
      { name: 'spark', sanitize: { span: { class: 'cdx-spark' } } },
      { name: 'ref', sanitize: { a: { href: true, target: true, rel: true, 'data-ref': true } } },
      { name: 'abbr', sanitize: { abbr: true } },
    ]))).not.toThrow();
  });

  it('refuses a tool name that is not a plain identifier, and unknown keys', () => {
    expect(() => readCustomToolsFile(fileWith([{ name: 'a b', sanitize: { kbd: true } }]))).toThrow(TypeError);
    expect(() => readCustomToolsFile(fileWith([{ name: 'kbd', sanitize: { kbd: true }, extra: 1 }]))).toThrow(TypeError);
  });
});

describe('custom inline tools in the contract: what it does not advertise', () => {
  it('does not advertise a mark on a tag the segment model keeps as an opaque embed', () => {
    const contract = contractWith([{ name: 'pic', sanitize: { img: { src: true } } }, { name: 'box', sanitize: { div: true } }]);

    expect(JSON.stringify(contract.commands)).not.toContain('"tag:img"');
    expect(JSON.stringify(contract.commands)).not.toContain('"tag:div"');
  });

  it('answers a core command, not an inline tool, when their names collide', () => {
    const contract = contractWith([{ name: 'kbd', sanitize: { kbd: true } }]);
    const collided: AgentContract = {
      ...contract,
      manifest: { ...contract.manifest, inlineTools: [...contract.manifest.inlineTools, { name: 'text.format', title: 'x', summary: 'x', level: 'structural' }] },
    };

    expect(describeContract(collided, { tool: 'text.format' })).toMatchObject({ command: { name: 'text.format' } });
  });
});
