import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

/**
 * The Markdown engine and the HTML parser also run on the server, inside Jint. There a sticky
 * regex (`/…/y`) that fails at `lastIndex` searches the rest of the string for
 * a later match, so one failed probe per `<` or `@` made a 16 000-tag document
 * quadratic: 12.5 s where V8 takes milliseconds. Scanners match at a position
 * by hand, or run an anchored regex on a slice that ends where no match can.
 */
const ENGINE = path.resolve(__dirname, '../../../../src/markdown/engine');
// The HTML tokenizer probed one sticky regex per `&` and `<!`: 80 000 `&` took 8 s in Jint.
const HTML = path.resolve(__dirname, '../../../../src/html');

const nodesOf = (root: ts.Node): ts.Node[] => {
  const all: ts.Node[] = [];
  const stack = [root];

  while (stack.length > 0) {
    const node = stack.pop() as ts.Node;

    all.push(node);
    ts.forEachChild(node, (child) => {
      stack.push(child);
    });
  }

  return all;
};

/** A `new RegExp` whose flags are not a literal without `y`. */
const stickyConstructor = (node: ts.Node): boolean => {
  const flags = ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'RegExp' ? node.arguments?.[1] : undefined;

  return flags !== undefined && (!ts.isStringLiteralLike(flags) || flags.text.includes('y'));
};

const stickyIn = (file: string, text = readFileSync(file, 'utf8')): string[] => {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const name = path.basename(file);
  const nodes = nodesOf(source).sort((left, right) => left.getStart() - right.getStart());

  return [
    ...nodes.filter((node) => ts.isRegularExpressionLiteral(node) && /\/[a-z]*y[a-z]*$/.test(node.text)).map((node) => `${name}: ${node.getText()}`),
    ...nodes.filter(stickyConstructor).map((node) => `${name}: new RegExp(…, ${(node as ts.NewExpression).arguments?.[1]?.getText() ?? ''})`),
  ];
};

const sourcesIn = (dir: string): string[] => readdirSync(dir).filter((name) => name.endsWith('.ts')).map((name) => path.join(dir, name));

describe('HTML parser: no sticky regexes', () => {
  const files = sourcesIn(HTML);

  it('scans the parser sources', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it('matches at a position without the y flag', () => {
    expect(files.flatMap((file) => stickyIn(file))).toStrictEqual([]);
  });
});

describe('markdown engine: no sticky regexes', () => {
  const files = sourcesIn(ENGINE);

  it('scans the engine sources', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it('matches at a position without the y flag', () => {
    expect(files.flatMap((file) => stickyIn(file))).toStrictEqual([]);
  });

  it('flags both spellings of a sticky regex, and nothing else', () => {
    const probe = "const a = /x/gy; const b = new RegExp('x', 'y'); const c = /y/g; const d = new RegExp('y', 'g');";

    expect(stickyIn('probe.ts', probe)).toStrictEqual(['probe.ts: /x/gy', "probe.ts: new RegExp(…, 'y')"]);
  });
});
