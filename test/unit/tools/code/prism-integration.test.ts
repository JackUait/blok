/**
 * Real integration test — actually runs Prism (no mocks).
 * Verifies that every HIGHLIGHTABLE_LANGUAGE produces tokenized output.
 */
import { describe, it, expect } from 'vitest';
import { tokenizePrism } from '../../../../src/tools/code/prism-loader';
import { HIGHLIGHTABLE_LANGUAGES, LANGUAGES } from '../../../../src/tools/code/constants';

const SNIPPETS: Record<string, string> = {
  javascript:  'const x = 1; function foo() { return x; }',
  typescript:  'const x: number = 1; interface Foo { bar: string; }',
  python:      'def hello(name: str) -> None:\n    print(f"Hello {name}")',
  java:        'public class Main { public static void main(String[] args) {} }',
  c:           '#include <stdio.h>\nint main() { printf("hi"); return 0; }',
  cpp:         '#include <iostream>\nint main() { std::cout << "hi"; }',
  csharp:      'using System; class Program { static void Main() {} }',
  go:          'package main\nfunc main() { fmt.Println("hi") }',
  rust:        'fn main() { let x: i32 = 1; println!("{}", x); }',
  ruby:        'def greet(name)\n  puts "Hello #{name}"\nend',
  php:         '<?php function greet($name) { echo "Hello $name"; }',
  swift:       'func greet(name: String) -> String { return "Hello \\(name)" }',
  kotlin:      'fun main() { val x = 1; println(x) }',
  sql:         'SELECT id, name FROM users WHERE active = true ORDER BY name',
  html:        '<!DOCTYPE html><html><body><h1>Hello</h1></body></html>',
  css:         'body { margin: 0; padding: 0; background: #fff; }',
  json:        '{"name":"blok","version":"1.0","keywords":["editor"]}',
  yaml:        'name: blok\nversion: 1.0\nkeywords:\n  - editor',
  markdown:    '# Title\n\n**Bold** and _italic_ text with `code`.',
  bash:        '#!/bin/bash\necho "Hello $USER"\nif [ -f file.txt ]; then cat file.txt; fi',
  shell:       'echo "test" | grep -v "ignore" | wc -l',
  dockerfile:  'FROM node:18-alpine\nWORKDIR /app\nCOPY . .\nRUN npm install',
  xml:         '<?xml version="1.0"?><root><item id="1">text</item></root>',
  graphql:     'query GetUser($id: ID!) { user(id: $id) { name email } }',
  r:           'x <- c(1, 2, 3)\nmean(x)\nplot(x, type="l")',
  scala:       'object Main extends App { val x: Int = 1; println(x) }',
  dart:        'void main() { final x = 1; print(x); }',
  lua:         'function greet(name)\n  print("Hello " .. name)\nend',
  latex:       '\\documentclass{article}\n\\begin{document}\nHello World\n\\end{document}',
};

describe('Prism integration', () => {
  it('returns null for plain text', async () => {
    const result = await tokenizePrism('const x = 1', 'plain text');
    expect(result).toBeNull();
  });

  const highlightableLangs = LANGUAGES
    .map(l => l.id)
    .filter(id => HIGHLIGHTABLE_LANGUAGES.has(id) && id !== 'mermaid');

  it.each(highlightableLangs)('tokenizes %s with token spans', async (lang) => {
    const code = SNIPPETS[lang] ?? 'hello world test code 123';
    const result = await tokenizePrism(code, lang);
    expect(result, `Expected non-null result for ${lang}`).not.toBeNull();
    expect(result, `Expected token spans for ${lang}`).toContain('class="token');
  });
});
