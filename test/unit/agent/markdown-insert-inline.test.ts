// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { OutputBlockData } from '../../../types';
import { describeContract } from '../../../src/shared/agent/describe';
import { nodeContract, openJsonSession } from './harness';

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const insert = async (markdown: string): Promise<OutputBlockData[]> => {
  const session = openJsonSession({ blocks: [] });
  const result = await session.execute({ commands: [{ name: 'markdown.insert', args: { markdown } }] });

  expect(result.ok ? null : result.error).toBeNull();

  return session.output().blocks;
};

const guidance = (): string => {
  const slice = describeContract(nodeContract(), { command: 'markdown.insert' });

  return 'command' in slice && typeof slice.command.guidance === 'string' ? slice.command.guidance : '';
};

/** What the description promises must match what markdown.insert really does. */
describe('markdown.insert inline formats', () => {
  it('tells the model which marks Markdown cannot write and what to use instead', () => {
    const text = guidance();

    for (const mark of ['underline', 'sup', 'sub', 'highlight', 'color', 'background']) {
      expect(text).toContain(`"${mark}"`);
    }
    expect(text).toContain('text.format');
    expect(text).toContain('{ "embed": { "equation": { "expression": "x" } } }');
  });

  it('puts the rule in the markdown argument, which ships in the tool schema', () => {
    const slice = describeContract(nodeContract(), { command: 'markdown.insert' });
    const args = 'command' in slice ? JSON.stringify(slice.command.args) : '';

    expect(args).toContain('text.format');
    expect(args).toContain('no syntax for underline');
    expect(args).toContain("describe({ command: 'markdown.insert' })");
  });

  it('keeps an equation embed written with block.insert', async () => {
    const session = openJsonSession({ blocks: [] });
    const text = [{ text: 'a ' }, { embed: { equation: { expression: 'x' } } }];
    const result = await session.execute({ commands: [{ name: 'block.insert', args: { type: 'paragraph', position: 'end', data: { text } } }] });

    expect(result.ok ? null : result.error).toBeNull();
    expect(session.output().blocks[0].data.text).toEqual(text);
  });

  it('reads __ as bold and _ as italic, never underline', async () => {
    const [block] = await insert('__b__ _i_');

    expect(block.data.text).toEqual([{ text: 'b', marks: { bold: true } }, { text: ' ' }, { text: 'i', marks: { italic: true } }]);
  });

  it('turns a single tilde into strikethrough, not subscript', async () => {
    const [block] = await insert('H~2~O');

    expect(block.data.text).toEqual([{ text: 'H' }, { text: '2', marks: { strikethrough: true } }, { text: 'O' }]);
  });

  it('keeps ==, ^ and inline HTML as literal text', async () => {
    const [block] = await insert('==hl== ^sup^ <u>u</u> <mark>m</mark>');

    expect(block.data.text).toEqual([{ text: '==hl== ^sup^ <u>u</u> <mark>m</mark>' }]);
  });

  it('splits a paragraph at $math$ into a latex code block', async () => {
    const blocks = await insert('a $x^2$ b');

    expect(blocks.map((block) => block.type)).toEqual(['paragraph', 'code', 'paragraph']);
    expect(blocks[1].data).toMatchObject({ code: 'x^2', language: 'latex' });
  });

  it.each([['a heading', '# a $x$'], ['a list item', '- a $x$'], ['a quote', '> a $x$']])(
    'keeps $math$ an inline equation in %s',
    async (_where, markdown) => {
      const [block] = await insert(markdown);

      expect(block.data.text).toEqual([{ text: 'a ' }, { embed: { equation: { expression: 'x' } } }]);
    }
  );

  it.each([['a heading', '# a $$x$$'], ['a list item', '- a $$x$$']])(
    'keeps $$math$$ an inline equation in %s, like $math$',
    async (_where, markdown) => {
      const [block] = await insert(markdown);

      expect(block.data.text).toEqual([{ text: 'a ' }, { embed: { equation: { expression: 'x' } } }]);
    }
  );

  it.each([['on its own line', '$$x$$'], ['inside a paragraph', 'a $$x$$ b'], ['fenced', '$$\nx\n$$']])(
    'makes $$math$$ %s a latex code block',
    async (_where, markdown) => {
      const blocks = await insert(markdown);

      expect(blocks.find((block) => block.type === 'code')?.data).toMatchObject({ code: 'x', language: 'latex' });
    }
  );

  it('states the $$ rule the importer follows', () => {
    const text = guidance();

    expect(text).toContain('$$x$$ follows the same rule as $x$');
    expect(text).toContain('A fenced $$ block is always a LaTeX code block');
    expect(text).toContain('sits directly in any other paragraph');
    expect(text).not.toContain('$$x$$ is always');
  });
});
