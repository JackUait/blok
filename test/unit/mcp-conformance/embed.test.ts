// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fixtureSuite, loadFixture } from './fixture-suite';

fixtureSuite('embed.json', 'embed');

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const toolsAnswer = (file: string, name: string): unknown => {
  const found = loadFixture(file).cases.find((c) => c.name === name);
  const expectation = found?.steps?.[0]?.expect;

  return isRecord(expectation) && isRecord(expectation.result) ? expectation.result.tools : undefined;
};

// Both cases start with the same contract flags (a files source), so Blok's tools must be the same.
describe('embed fixture', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('records the Blok tools of the standalone server, entry for entry', () => {
    const standalone = toolsAnswer('protocol.json', 'stdio tools/list, default options, 2025-11-25');
    const embedded = toolsAnswer('embed.json', "tools/list has the host tool and Blok's tools, Blok's schemas equal to standalone");

    expect(Array.isArray(standalone)).toBe(true);
    expect(isRecord(embedded)).toBe(true);
    const { host_echo: hostEcho, ...blok } = isRecord(embedded) ? embedded : {};

    expect(hostEcho).toBe('<host>');
    expect(blok).toEqual(Object.fromEntries((Array.isArray(standalone) ? standalone : []).map((tool: { name: string }) => [tool.name, tool])));
  });
});
