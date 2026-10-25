// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadParityCases } from './corpus';
import { checkMcpCase } from './mcp-harness';

const cases = loadParityCases();

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

it('has cases to exercise', () => {
  expect(cases.length).toBeGreaterThan(0);
});

describe.each(cases)('mcp stored runner: $name', (c) => {
  it('matches its expectation, the golden and the json answers through blok-mcp --source files', async () => {
    await checkMcpCase(c, 'mcp-stored');
  });
});
