import { describe, it, expect, afterAll } from 'vitest';
import { tokenizeCode, disposeHighlighter } from '../../../../src/tools/code/shiki-loader';
import { HIGHLIGHTABLE_LANGUAGES } from '../../../../src/tools/code/constants';

const SNIPPETS: Record<string, string> = {
  javascript: 'const x = 1;\nfunction foo() { return x; }',
  typescript: 'const x: number = 1;\ninterface Foo { bar: string; }',
  python: 'def hello():\n  print("hello")\n  return 42',
  java: 'public class Main {\n  public static void main(String[] args) {}\n}',
  c: '#include <stdio.h>\nint main() { return 0; }',
  cpp: '#include <iostream>\nint main() { std::cout << "hello"; }',
  csharp: 'using System;\nclass Program { static void Main() {} }',
  go: 'package main\nimport "fmt"\nfunc main() { fmt.Println("hello") }',
  rust: 'fn main() {\n  let x: i32 = 42;\n  println!("{}", x);\n}',
  ruby: 'def hello\n  puts "hello world"\nend',
  php: '<?php\nfunction hello() { echo "hello"; }',
  swift: 'func greet(name: String) -> String {\n  return "Hello, " + name\n}',
  kotlin: 'fun main() {\n  val x = 42\n  println(x)\n}',
  sql: 'SELECT id, name FROM users WHERE age > 18;',
  html: '<div class="hello"><p>Hello</p></div>',
  css: 'body { color: red; }\n.class { display: flex; }',
  json: '{"name": "blok", "version": "1.0"}',
  yaml: 'name: blok\nversion: 1.0\nitems:\n  - one',
  markdown: '# Hello\n\n**bold** and *italic*',
  bash: '#!/bin/bash\necho "hello"\nfor i in 1 2 3; do echo $i; done',
  shell: 'ls -la | grep test',
  dockerfile: 'FROM node:18\nWORKDIR /app\nCOPY . .\nRUN npm install',
  xml: '<?xml version="1.0"?>\n<root><item>Hello</item></root>',
  graphql: 'type Query {\n  user(id: ID!): User\n}',
  r: 'x <- c(1, 2, 3)\nmean(x)',
  scala: 'object Main extends App {\n  val x: Int = 42\n}',
  dart: 'void main() {\n  var x = 42;\n  print(x);\n}',
  lua: 'function hello()\n  print("hello")\nend',
  latex: '\\documentclass{article}\n\\begin{document}\nHello\n\\end{document}',
  mermaid: 'graph TD\n  A[Start] --> B[End]',
};

describe('shiki integration', { timeout: 60_000 }, () => {
  afterAll(() => {
    disposeHighlighter();
  });

  it('should have snippets for all highlightable languages', () => {
    for (const lang of HIGHLIGHTABLE_LANGUAGES) {
      expect(SNIPPETS[lang], `missing snippet for "${lang}"`).toBeDefined();
    }
  });

  for (const lang of HIGHLIGHTABLE_LANGUAGES) {
    it.concurrent(`tokenizes ${lang}`, async () => {
      const snippet = SNIPPETS[lang];
      const result = await tokenizeCode(snippet, lang);

      expect(result).not.toBeNull();
      expect(result!.light).toBeDefined();
      expect(result!.dark).toBeDefined();
      expect(result!.light.tokens.length).toBeGreaterThan(0);
      expect(result!.dark.tokens.length).toBeGreaterThan(0);
      expect(result!.light.fg).toBeTruthy();
      expect(result!.dark.fg).toBeTruthy();

      // Verify actual syntax highlighting happened — multiple distinct colors
      const lightColors = new Set<string>();

      for (const line of result!.light.tokens) {
        for (const token of line) {
          lightColors.add(token.color);
        }
      }

      // Mermaid grammar doesn't produce distinct colors in one-light theme
      const minColors = lang === 'mermaid' ? 1 : 2;

      expect(
        lightColors.size,
        `${lang}: expected multiple colors for syntax highlighting, got ${[...lightColors].join(', ')}`
      ).toBeGreaterThanOrEqual(minColors);

      // For multi-line snippets, verify document-relative offsets
      // Find the first non-empty line after line 0
      if (snippet.includes('\n')) {
        const lines = result!.light.tokens;
        const nonEmptyIdx = lines.findIndex((line, i) => i > 0 && line.length > 0);

        if (nonEmptyIdx !== -1) {
          const firstToken = lines[nonEmptyIdx][0];
          // Compute expected minimum offset: sum of all preceding source lines including newlines
          const sourceLines = snippet.split('\n');
          const expectedMinOffset = sourceLines
            .slice(0, nonEmptyIdx)
            .reduce((sum, line) => sum + line.length + 1, 0);

          expect(
            firstToken.offset,
            `${lang}: token offset on line ${nonEmptyIdx} should be >= ${expectedMinOffset}, got ${firstToken.offset}`
          ).toBeGreaterThanOrEqual(expectedMinOffset);
        }
      }
    });
  }

  it('"plain text" returns null', async () => {
    const result = await tokenizeCode('hello world', 'plain text');

    expect(result).toBeNull();
  });

  it('token offsets are document-relative across lines', async () => {
    const code = 'const x = 1;\nconst y = 2;';
    const result = await tokenizeCode(code, 'javascript');

    expect(result).not.toBeNull();

    const line2Tokens = result!.light.tokens[1];

    expect(line2Tokens.length).toBeGreaterThan(0);

    // "const" on line 2 starts at offset 13 (after "const x = 1;\n")
    expect(line2Tokens[0].offset).toBe(13);
  });
});
