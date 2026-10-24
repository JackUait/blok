// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderAgentTools } from '../../../src/agent/render-tools';
import { measureSchema } from '../../../src/agent/schema-walk';
import { buildMcpContracts } from '../../../src/mcp/contract';

import type { RenderedTool } from '../../../src/agent/render-tools';
import type { BlokCustomToolsFile } from '../../../types/tool-manifest';

const manifest: BlokCustomToolsFile = {
  formatVersion: 1,
  blocks: [],
  inlineTools: [
    { name: 'kbd', title: 'Keyboard', sanitize: { kbd: { 'data-key': true } } },
    { name: 'spark', title: 'Spark', sanitize: { span: { class: 'cdx-spark' } } },
    { name: 'sample', sanitize: { samp: true } },
  ],
};

const executeInput = (tools: RenderedTool[]): unknown => {
  const execute = tools.find(tool => tool.name === 'blok_execute');

  return execute !== undefined && 'parameters' in execute ? execute.parameters : undefined;
};

const propertiesOf = (customTools: BlokCustomToolsFile | undefined, schema: 'full' | 'mixed'): number =>
  measureSchema(executeInput(renderAgentTools(
    buildMcpContracts({ pageTitles: 'off', manifest: customTools }).stored,
    { format: 'openai', schema }
  ))).properties;

describe('rendered schema size with custom inline marks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('stays inside the OpenAI limits in full and mixed', () => {
    const contract = buildMcpContracts({ pageTitles: 'off', manifest }).stored;

    expect(() => renderAgentTools(contract, { format: 'openai', schema: 'full' })).not.toThrow();
    expect(() => renderAgentTools(contract, { format: 'openai', schema: 'mixed' })).not.toThrow();
  });

  it('grows mixed by the custom marks once, because the marks schema is shared', () => {
    const growth = propertiesOf(manifest, 'mixed') - propertiesOf(undefined, 'mixed');

    // Three marks plus kbd's and spark's attribute: one shared marks definition.
    expect(growth).toBe(5);
  });
});
