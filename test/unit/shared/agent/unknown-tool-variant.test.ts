// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { describeContract } from '../../../../src/shared/agent/describe';
import { nodeContract, openJsonSession } from '../../agent/harness';

const seed = { blocks: [{ id: 'p', type: 'paragraph', data: { text: [{ text: 'call Ana' }] } }] };

const errorOf = (result: Awaited<ReturnType<ReturnType<typeof openJsonSession>['execute']>>) => {
  if (result.ok) {
    throw new Error('Expected the batch to fail.');
  }

  return result.error;
};

describe('a block type that is really a variant of a tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('block.convert names the tool and data to use, and that data works', async () => {
    const session = openJsonSession(seed);

    try {
      const error = errorOf(await session.execute({ commands: [{ name: 'block.convert', args: { id: 'p', type: 'checklist' } }] }));

      expect(error.code).toBe('UNKNOWN_TOOL');
      expect(error.message).toMatch(/^No block tool "checklist" is registered\. .*type "list" with data \{"style":"checklist"\}.* Known: /);
      expect(error.details).toMatchObject({ variants: [{ tool: 'list', data: { style: 'checklist' } }] });

      const variants = (error.details as { variants: Array<{ tool: string; data: Record<string, unknown> }> }).variants;
      const [hint] = variants;
      const retry = await session.execute({ commands: [{ name: 'block.convert', args: { id: 'p', type: hint.tool, data: hint.data } }] });

      expect(retry.ok).toBe(true);
      expect(variants).toHaveLength(1);
      expect(session.output().blocks).toMatchObject([{ id: 'p', type: 'list', data: { style: 'checklist', text: [{ text: 'call Ana' }] } }]);
    } finally {
      session.close();
    }
  });

  it('block.insert gives the same hint', async () => {
    const session = openJsonSession(seed);

    try {
      const error = errorOf(await session.execute({ commands: [{ name: 'block.insert', args: { type: 'numbered-list', data: { text: 'x' } } }] }));

      expect(error.message).toContain('type "list" with data {"style":"ordered"}');
    } finally {
      session.close();
    }
  });

  it('a name that matches no variant gets no hint', async () => {
    const session = openJsonSession(seed);

    try {
      const error = errorOf(await session.execute({ commands: [{ name: 'block.convert', args: { id: 'p', type: 'foo' } }] }));

      expect(error.message).toMatch(/^No block tool "foo" is registered\. Known: /);
      expect(error.details).not.toHaveProperty('variants');
    } finally {
      session.close();
    }
  });

  it('describe({ tool }) gives the same hint', () => {
    const session = openJsonSession(seed);

    try {
      expect(() => session.describe({ tool: 'checklist' })).toThrow('type "list" with data {"style":"checklist"}');
    } finally {
      session.close();
    }
  });
});

describe('describe({ tool }) given a command name', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('answers with that command, so the lookup is not wasted', () => {
    const session = openJsonSession(seed);

    try {
      expect(session.describe({ tool: 'block.convert' })).toMatchObject({ command: { name: 'block.convert' } });
    } finally {
      session.close();
    }
  });

  it('a registered tool with that name still wins', () => {
    const contract = nodeContract();
    const tool = { ...contract.manifest.blocks[0], name: 'block.convert' };
    const clash = { ...contract, manifest: { ...contract.manifest, blocks: [...contract.manifest.blocks, tool] } };

    expect(describeContract(clash, { tool: 'block.convert' })).toMatchObject({ tool: { name: 'block.convert' } });
  });

  it('block.convert says the text carries over and how to reach a variant', () => {
    const session = openJsonSession(seed);

    try {
      const slice = session.describe({ command: 'block.convert' });
      const summary = 'command' in slice ? slice.command.summary : '';

      expect(summary).toContain('text carries over');
      expect(summary).toMatch(/variant.*data/);
    } finally {
      session.close();
    }
  });
});

describe('data a tool does not take', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('block.convert lists the fields the tool takes and says the text carries over', async () => {
    const session = openJsonSession(seed);

    try {
      const error = errorOf(await session.execute({ commands: [{ name: 'block.convert', args: {
        id: 'p', type: 'list', data: { style: 'checklist', items: [{ content: 'call Ana' }] },
      } }] }));

      expect(error.code).toBe('DATA_REJECTED');
      expect(error.message).toMatch(/unknown field "items"\..*"list" takes: .*\btext\b.*\bstyle\b/);
      expect(error.message).toContain('carries the text over');
      expect(error.message).toContain('describe({ tool: "list" })');
    } finally {
      session.close();
    }
  });

  it('block.insert lists the fields but says nothing about carrying text', async () => {
    const session = openJsonSession(seed);

    try {
      const error = errorOf(await session.execute({ commands: [{ name: 'block.insert', args: { type: 'list', data: { items: [] } } }] }));

      expect(error.code).toBe('DATA_REJECTED');
      expect(error.message).toMatch(/"list" takes: /);
      expect(error.message).not.toContain('carries the text over');
    } finally {
      session.close();
    }
  });
});
