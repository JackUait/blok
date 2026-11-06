import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { type FixtureCase, type FixtureFile, runCase } from './exchange';
import { conformanceCommand } from './mcp-process';

export const FIXTURES_DIR = join(__dirname, 'fixtures');
// Each case spawns the binary; a Node start under load takes seconds.
export const CASE_TIMEOUT_MS = 90_000;

export const isUpdate = (): boolean => process.env.BLOK_MCP_CONFORMANCE_UPDATE === '1';

export const loadFixture = (file: string): FixtureFile => {
  const parsed = JSON.parse(readFileSync(join(FIXTURES_DIR, file), 'utf8')) as FixtureFile;

  if (!Array.isArray(parsed.cases)) {
    throw new Error(`${file} has no "cases" array`);
  }

  return parsed;
};

const withDefaults = (defaults: Partial<FixtureCase> | undefined, c: FixtureCase): FixtureCase => ({ ...defaults, ...c });

/**
 * One vitest test per fixture case, skipped unless the runner named a binary.
 * Under --update the file is rewritten with what the binary answered.
 */
export const fixtureSuite = (file: string): void => {
  const command = conformanceCommand();
  const fixture = loadFixture(file);
  const recorded: FixtureCase[] = fixture.cases.map((c) => structuredClone(c));

  describe.skipIf(command === undefined)(`MCP conformance: ${file}`, () => {
    it('has cases', () => {
      expect(fixture.cases.length).toBeGreaterThan(0);
    });

    fixture.cases.forEach((c, index) => {
      it(c.name, async () => {
        if (command === undefined) {
          return;
        }
        const result = await runCase(command, withDefaults(fixture.defaults, c), isUpdate());

        if (isUpdate()) {
          // Defaults stay in "defaults"; only the case's own keys and its expectations are written.
          const own = Object.fromEntries(Object.entries(result).filter(([key]) => key in c || key.startsWith('expect') || key === 'steps'));

          recorded[index] = own as unknown as FixtureCase;
        }
      }, CASE_TIMEOUT_MS);
    });

    afterAll(() => {
      if (isUpdate() && command !== undefined) {
        writeFileSync(join(FIXTURES_DIR, file), `${JSON.stringify({ ...fixture, cases: recorded }, null, 2)}\n`);
      }
    });
  });
};
