// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentFailure } from '../../../../src/shared/agent/errors';
import { planOn, stubPorts, TOOLS, tool } from './fixtures';

import type { AgentPorts } from '../../../../src/shared/agent/types';
import type { AgentCommand, OutputData } from '../../../../types';

const doc: OutputData = { blocks: [
  { id: 'p', type: 'paragraph', data: { text: [{ text: 'P' }] } },
  { id: 'a', type: 'audio', data: { url: 'https://cdn.example/a.mp3' } },
] };

const tools = new Map([
  ...TOOLS,
  ['audio', tool('audio')],
  ['video', tool('video')],
  ['file', tool('file')],
  ['bookmark', tool('bookmark')],
  ['database-row', tool('database-row')],
]);

const BAD = 'https://attacker.example/x?d=SECRET';

/** Allows cdn.example only. Reads HTML as a list of `src="..."` values, which is all these tests write. */
const gate = (): NonNullable<AgentPorts['media']> => ({
  allows: vi.fn((url: string) => url.startsWith('https://cdn.example/')),
  urlsInHtml: vi.fn((html: string) => [...html.matchAll(/src="([^"]*)"/g)].map(match => match[1])),
});

const refusal = (commands: AgentCommand[], media = gate()): AgentFailure['error'] => {
  try {
    planOn(doc, commands, { tools, ports: stubPorts({ media }) });
  } catch (error) {
    if (error instanceof AgentFailure) {
      return error.error;
    }
    throw error;
  }
  throw new Error('Expected the batch to be refused');
};

const insert = (type: string, data: Record<string, unknown>): AgentCommand => ({ name: 'block.insert', args: { type, data } });

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('agent-written media URLs', () => {
  it.each<[string, AgentCommand]>([
    ['an image url', insert('image', { url: BAD })],
    ['a video rendition', insert('video', { url: 'https://cdn.example/v.mp4', variants: [{ url: BAD, mimeType: 'video/webm' }] })],
    ['an audio cover', insert('audio', { url: 'https://cdn.example/a.mp3', coverUrl: BAD })],
    ['a file url', insert('file', { url: BAD, fileName: 'a.pdf' })],
    ['a bookmark preview image', insert('bookmark', { url: 'https://site.example', image: BAD })],
    ['a bookmark favicon', insert('bookmark', { url: 'https://site.example', favicon: BAD })],
    ['a row cover', insert('database-row', { properties: {}, position: 'a', cover: BAD })],
    ['a row file cell', insert('database-row', { properties: { f: [{ id: '1', name: 'x.png', url: BAD }] }, position: 'a' })],
    ['an image in inline HTML', insert('paragraph', { text: [{ text: 'x ' }, { embed: { html: `<img src="${BAD}">` } }] })],
    ['a page icon picture', { name: 'doc.setIcon', args: { icon: { type: 'image', url: BAD } } }],
    ['a change to an existing block',{ name: 'block.update', args: { id: 'a', data: { coverUrl: BAD } } }],
  ])('refuses %s on a host the hook refuses', (_label, command) => {
    expect(refusal([command])).toMatchObject({
      code: 'DATA_REJECTED',
      commandIndex: 0,
      details: { reason: 'media-url', url: BAD },
    });
  });

  it('names the URL in the message, so the model can drop it', () => {
    expect(refusal([insert('image', { url: BAD })]).message).toContain(BAD);
  });

  it('does not refuse a link: a bookmark url and a link mark only open on a click', () => {
    const media = gate();

    expect(() => planOn(doc, [
      insert('bookmark', { url: BAD }),
      insert('paragraph', { text: [{ text: 'x', marks: { link: { href: BAD } } }] }),
    ], { tools, ports: stubPorts({ media }) })).not.toThrow();
  });

  it('lets URLs the hook allows through', () => {
    expect(() => planOn(doc, [insert('image', { url: 'https://cdn.example/i.png' })], {
      tools, ports: stubPorts({ media: gate() }),
    })).not.toThrow();
  });

  it('checks nothing when the runtime has no hook, as MCP has none', () => {
    const { plan } = planOn(doc, [insert('image', { url: BAD })], { tools });

    expect(plan.edits).toHaveLength(1);
  });

  it('lists every refused URL in one failure', () => {
    const error = refusal([insert('image', { url: BAD }), insert('file', { url: `${BAD}2` })]);

    expect(error.others).toEqual([expect.objectContaining({ code: 'DATA_REJECTED', commandIndex: 1 })]);
  });
});
