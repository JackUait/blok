import { describe, expect, it } from 'vitest';
import { parse, parseFragment, serialize as parse5Serialize, serializeOuter as parse5SerializeOuter, type DefaultTreeAdapterMap } from 'parse5';
import type { ChildNode, ParentNode } from '../../../src/html/tree';
import { serialize, serializeOuter } from '../../../src/html/serializer';
import { fuzzHtml, realDocuments, storedFields, treeConstructionInputs } from './corpus';

/** parse5's default tree is our tree plus source locations, so it type-checks as ours. */
const asOurs = (node: DefaultTreeAdapterMap['parentNode']): ParentNode => node;

const FUZZ_RUNS = 20_000;
/** Every node is checked with serializeOuter in trees up to this size; bigger trees are sampled. */
const OUTER_SAMPLE = 400;

const divContext = ((): DefaultTreeAdapterMap['element'] => {
  const div = parseFragment('<div></div>').childNodes[0];

  if (!('tagName' in div)) {
    throw new Error('expected a div element');
  }

  return div;
})();

const isParent = (node: ChildNode): node is ChildNode & ParentNode => 'childNodes' in node;

const allNodes = (root: ParentNode): ChildNode[] => {
  const out: ChildNode[] = [];
  const stack: ParentNode[] = [root];

  while (stack.length > 0) {
    const parent = stack.pop();

    if (parent === undefined) {
      break;
    }
    const container = 'content' in parent ? parent.content : parent;

    out.push(...container.childNodes);
    stack.push(...container.childNodes.filter(isParent));
  }

  return out;
};

interface Report {
  trees: number;
  outerChecks: number;
  parseErrors: number;
  /** parse5 serializer calls that overflowed the call stack; skipped. */
  oracleOverflows: number;
  /** Error kinds parse5 threw, other than RangeError. */
  otherErrors: string[];
  mismatches: string[];
}

const firstDiff = (a: string, b: string): number => {
  const limit = Math.min(a.length, b.length);
  const index = Array.from({ length: limit }, (_, i) => i).find((i) => a[i] !== b[i]);

  return index ?? limit;
};

const describeMismatch = (label: string, ours: string, theirs: string): string => {
  const at = firstDiff(ours, theirs);

  return `${label} @${at}: ours ${JSON.stringify(ours.slice(Math.max(0, at - 20), at + 40))} parse5 ${JSON.stringify(theirs.slice(Math.max(0, at - 20), at + 40))}`;
};

/** Whole-tree inner HTML, then outer and inner HTML of each sampled node. */
const checkTree = (label: string, tree: ParentNode): { outerChecks: number; oracleOverflows: number; mismatches: string[] } => {
  const overflows = { count: 0 };
  // parse5's serializer recurses and overflows the call stack on deep trees (a
  // fixture page nests 5001 divs). Ours runs first and unguarded, so it must not throw.
  const compare = (what: string, ours: string, theirs: () => string): string[] => {
    try {
      const expected = theirs();

      return ours === expected ? [] : [describeMismatch(`${label} ${what}`, ours, expected)];
    } catch (error) {
      if (!(error instanceof RangeError)) {
        throw error;
      }
      overflows.count += 1;

      return [];
    }
  };
  const nodes = allNodes(tree);
  const step = Math.max(1, Math.ceil(nodes.length / OUTER_SAMPLE));
  const sample = nodes.filter((_, index) => index % step === 0);
  const mismatches = [
    ...compare('', serialize(tree), () => parse5Serialize(tree)),
    ...sample.flatMap((node) => [
      ...compare(`outer ${node.nodeName}`, serializeOuter(node), () => parse5SerializeOuter(node)),
      ...(isParent(node) ? compare(`inner ${node.nodeName}`, serialize(node), () => parse5Serialize(node)) : []),
    ]),
  ];

  return { outerChecks: sample.length, oracleOverflows: overflows.count, mismatches };
};

const BUILDERS: Array<[string, (html: string) => DefaultTreeAdapterMap['parentNode']]> = [
  ['parse', (html) => parse(html)],
  ['parseFragment', (html) => parseFragment(html)],
  ['parseFragment(div)', (html) => parseFragment(divContext, html, {})],
];

/** Builds each input three ways and compares. parse5 throws a RangeError on adjacent low surrogates; those are counted and skipped. */
const run = (inputs: Array<{ name: string; html: string }>): Report => {
  const report: Report = { trees: 0, outerChecks: 0, parseErrors: 0, oracleOverflows: 0, otherErrors: [], mismatches: [] };

  inputs.forEach(({ name, html }) => {
    BUILDERS.forEach(([mode, build]) => {
      const tree = ((): ParentNode | null => {
        try {
          return asOurs(build(html));
        } catch (error) {
          report.parseErrors += 1;
          if (!(error instanceof RangeError)) {
            report.otherErrors.push(`${name} [${mode}]: ${String(error)}`);
          }

          return null;
        }
      })();

      if (tree !== null) {
        const found = checkTree(`${name} [${mode}]`, tree);

        report.trees += 1;
        report.outerChecks += found.outerChecks;
        report.oracleOverflows += found.oracleOverflows;
        report.mismatches.push(...found.mismatches);
      }
    });
  });

  return report;
};

const expectClean = (report: Report, minTrees: number): void => {
  expect(report.mismatches.slice(0, 3)).toEqual([]);
  expect(report.mismatches.length).toBe(0);
  expect(report.otherErrors).toEqual([]);
  expect(report.trees).toBeGreaterThanOrEqual(minTrees);
  console.log(`trees ${report.trees}, outer checks ${report.outerChecks}, parse5 threw ${report.parseErrors}, parse5 serializer overflowed ${report.oracleOverflows}`);
};

describe('html serializer matches parse5 on the corpus', () => {
  it('real documents', () => {
    const docs = realDocuments();

    expectClean(run(docs), docs.length * 3);
  }, 600_000);

  it('html5lib tree-construction inputs', () => {
    const inputs = treeConstructionInputs().map((html, index) => ({ name: `tc#${index}`, html }));

    expectClean(run(inputs), inputs.length * 3);
  }, 600_000);

  it('stored document fields', () => {
    const inputs = storedFields().map((html, index) => ({ name: `field#${index}`, html }));

    expectClean(run(inputs), inputs.length * 3);
  }, 600_000);

  it(`${FUZZ_RUNS} fuzz inputs`, () => {
    const inputs = Array.from({ length: FUZZ_RUNS }, (_, seed) => ({ name: `fuzz#${seed}`, html: fuzzHtml(seed) }));
    const report = run(inputs);

    expectClean(report, (FUZZ_RUNS * 3) - report.parseErrors);
  }, 600_000);
});
