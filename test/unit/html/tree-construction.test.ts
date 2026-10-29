/**
 * html5lib tree-construction suites: upstream html5lib-tests and the fork
 * parse5 runs as its primary suite. Trees only, not errors, as parse5's own
 * upstream run does.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as parse5 from 'parse5';
import { describe, expect, it } from 'vitest';
import { createElement, parse, parseFragment } from '../../../src/html';
import { parseDatFile, serializeToDatFileFormat, type DatTest } from './dat';

const HTML5LIB = join(__dirname, '..', '..', 'fixtures', 'html5lib');

interface Case extends DatTest {
  id: string;
}

const load = (dir: string): Case[] =>
  readdirSync(join(HTML5LIB, dir))
    .filter((file) => file.endsWith('.dat'))
    .sort()
    .flatMap((file) =>
      parseDatFile(readFileSync(join(HTML5LIB, dir, file), 'utf8')).map((test, index) => ({
        ...test,
        id: `${index}.${file.replace('.dat', '')}`,
      }))
    );

const keyOf = (test: DatTest): string =>
  JSON.stringify([test.input, test.fragmentContext?.namespaceURI, test.fragmentContext?.tagName, test.scriptingEnabled]);

const ours = (test: DatTest): string => {
  const { fragmentContext } = test;
  const root = fragmentContext === null
    ? parse(test.input)
    : parseFragment(createElement(fragmentContext.tagName, fragmentContext.namespaceURI, []), test.input);

  return serializeToDatFileFormat(root);
};

const theirs = (test: DatTest): string => {
  const { fragmentContext } = test;
  const context = fragmentContext === null
    ? null
    : parse5.defaultTreeAdapter.createElement(fragmentContext.tagName, fragmentContext.namespaceURI, []);
  const root = context === null ? parse5.parse(test.input) : parse5.parseFragment(context, test.input, {});

  return serializeToDatFileFormat(root);
};

const upstream = load('tree-construction');
const upstreamKeys = new Set(upstream.map(keyOf));
const fork = load('tree-construction-fork');
const forkOnly = fork.filter((test) => !upstreamKeys.has(keyOf(test)));

/** Scripting is fixed on, so `#script-off` cases do not apply. */
const runnable = (tests: Case[]): Case[] => tests.filter((test) => test.scriptingEnabled);

/**
 * parse5 expects these fork cases to fail: the fork predates a spec change to
 * foreign content (parse5 GH-448). Upstream has the same inputs with updated trees.
 */
const OUTDATED_FORK_CASES = ['0', '1', '38', '40', '47', '48'].map((index) => `${index}.foreign-fragment`);

describe('html5lib tree construction', () => {
  it('loads every case, so a reader bug cannot drop tests silently', () => {
    expect(upstream).toHaveLength(1764);
    expect(upstream.filter((test) => !test.scriptingEnabled)).toHaveLength(27);
    expect(fork).toHaveLength(1697);
    expect(forkOnly).toHaveLength(1);
    expect(forkOnly.filter((test) => !test.scriptingEnabled)).toHaveLength(0);
  });

  describe('upstream', () => {
    it.each(runnable(upstream).map((test) => [test.id, test] as const))('%s', (_id, test) => {
      expect(ours(test)).toBe(test.expected);
    });
  });

  describe('fork, cases not in upstream', () => {
    it.each(runnable(forkOnly).map((test) => [test.id, test] as const))('%s', (_id, test) => {
      expect(ours(test)).toBe(test.expected);
    });
  });

  describe('fork cases with outdated expectations', () => {
    it.each(OUTDATED_FORK_CASES)('%s fails for parse5 and for us, with the same tree', (id) => {
      const test = fork.find((candidate) => candidate.id === id);

      expect(test).toBeDefined();
      if (test === undefined) {
        return;
      }
      expect(ours(test)).toBe(theirs(test));
      expect(theirs(test)).not.toBe(test.expected);
    });
  });
});
