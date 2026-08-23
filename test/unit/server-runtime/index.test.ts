// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { invoke } from '../../../src/server-runtime';

describe('server runtime boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('runs through one global boundary without DOM globals', () => {
    expect(typeof document).toBe('undefined');
    expect(typeof window).toBe('undefined');
    expect(globalThis.blokServerInvoke).toBe(invoke);
  });

  it('converts Markdown into a serialized OutputData envelope', async () => {
    const output = JSON.parse(await invoke('markdownToBlocks', '{"markdown":"# Hello"}')) as unknown;

    expect(output).toMatchObject({
      blocks: [{ type: 'header', data: { text: 'Hello', level: 1 } }],
    });
  });

  it('loads the inlined math extensions', async () => {
    const output = JSON.parse(await invoke('markdownToBlocks', '{"markdown":"$$E = mc^2$$"}')) as unknown;

    expect(output).toMatchObject({
      blocks: [{ type: 'code', data: { code: 'E = mc^2', language: 'latex' } }],
    });
  });

  it('renders a serialized document to HTML', async () => {
    const html = await invoke(
      'blocksToHtml',
      '{"blocks":[{"type":"paragraph","data":{"text":"Hi <b>there</b>"}}]}'
    );

    expect(html).toBe('<p>Hi <b>there</b></p>');
  });

  it('renders a serialized document to plain text', async () => {
    const plainText = await invoke(
      'blocksToPlainText',
      '{"blocks":[{"type":"paragraph","data":{"text":"Hi <b>there</b>"}}]}'
    );

    expect(plainText).toBe('Hi there');
  });

  it('refuses a document without a blocks array', async () => {
    await expect(invoke('blocksToHtml', '{"wrong":[]}')).rejects.toThrow('`blocks` array');
  });

  it('refuses an unknown operation', async () => {
    await expect(invoke('unknown', '{}')).rejects.toThrow('Unsupported Blok runtime operation');
  });
});
