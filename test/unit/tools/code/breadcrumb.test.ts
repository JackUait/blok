import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { codeBreadcrumb } from '../../../../src/tools/code/breadcrumb';

const JS = [
  '// Fibonacci sequence with memoization',
  'const memo = new Map();',
  '',
  'function fibonacci(n) {',
  '  if (n <= 1) return n;',
  '  if (memo.has(n)) {',
  '    return memo.get(n);',
  '  }',
  '',
  '  return fibonacci(n - 1) + fibonacci(n - 2);',
  '}',
].join('\n');

const PY = [
  'class Cache:',
  '    def get(self, key):',
  '        if key in self.items:',
  '            return self.items[key]',
  '        return None',
].join('\n');

describe('codeBreadcrumb', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('is empty on a top-level line', () => {
    expect(codeBreadcrumb(JS, 1)).toEqual([]);
  });

  it('names the function the caret is in', () => {
    expect(codeBreadcrumb(JS, 4)).toEqual(['fibonacci()']);
  });

  it('names the function when the caret is on its own header line', () => {
    expect(codeBreadcrumb(JS, 3)).toEqual(['fibonacci()']);
  });

  it('chains nested blocks from outer to inner', () => {
    expect(codeBreadcrumb(JS, 6)).toEqual(['fibonacci()', 'if (memo.has(n))']);
  });

  it('keeps the enclosing block on the closing brace line', () => {
    expect(codeBreadcrumb(JS, 7)).toEqual(['fibonacci()', 'if (memo.has(n))']);
  });

  it('uses the block above a blank line inside it', () => {
    expect(codeBreadcrumb(JS, 8)).toEqual(['fibonacci()']);
  });

  it('keeps a top-level block on its closing brace', () => {
    expect(codeBreadcrumb(JS, 10)).toEqual(['fibonacci()']);
  });

  it('is empty on a blank top-level line between blocks', () => {
    expect(codeBreadcrumb(JS, 2)).toEqual([]);
  });

  it('reads Python blocks by indentation and drops the trailing colon', () => {
    expect(codeBreadcrumb(PY, 3)).toEqual(['class Cache', 'get()', 'if key in self.items']);
  });

  it('names Rust and Go functions', () => {
    expect(codeBreadcrumb('pub fn run() {\n    go();\n}', 1)).toEqual(['run()']);
    expect(codeBreadcrumb('func main() {\n\tgo()\n}', 1)).toEqual(['main()']);
  });

  it('shortens a long header with an ellipsis', () => {
    const code = `if (${'a'.repeat(60)}) {\n  x();\n}`;
    const [label] = codeBreadcrumb(code, 1);

    expect(label.length).toBe(32);
    expect(label.endsWith('…')).toBe(true);
  });

  it('is empty for a line index outside the code', () => {
    expect(codeBreadcrumb(JS, 99)).toEqual([]);
    expect(codeBreadcrumb('', 0)).toEqual([]);
  });
  it('stays fast on a header line with a huge run of spaces', () => {
    const code = `if (a${' '.repeat(200_000)}b) x\n  y();`;
    const start = performance.now();
    const [label] = codeBreadcrumb(code, 1);

    expect(performance.now() - start).toBeLessThan(1000);
    expect(label.startsWith('if (a')).toBe(true);
  });

  it('drops an arrow before the opening brace', () => {
    expect(codeBreadcrumb('const run = () => {\n  go();\n}', 1)).toEqual(['const run = ()']);
  });
});
