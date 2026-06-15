/**
 * Theme coverage test — every Prism token class emitted for every highlightable
 * language MUST resolve to a color rule in BOTH the light and dark stylesheets,
 * either directly or by inheriting from a colored ancestor token.
 *
 * A token that matches no rule (and has no colored ancestor) renders in the
 * default code-text color, i.e. it is under-highlighted. This test fails when
 * any such orphan exists — including new ones introduced by a future Prism upgrade.
 */
import { describe, it, expect } from 'vitest';
import { tokenizePrism } from '../../../../src/tools/code/prism-loader';
import { LIGHT_RULES, DARK_RULES } from '../../../../src/tools/code/prism-applier';
import { HIGHLIGHTABLE_LANGUAGES, LANGUAGES } from '../../../../src/tools/code/constants';

// Rich snippets chosen to exercise as many token classes as each grammar emits.
const SNIPPETS: Record<string, string> = {
  javascript:  'const x = 1;\n// comment\nfunction foo(a, b) { return `t${a}` + /re/g; }\nclass C extends D {}\nconst o = {k: 1, m() {}};\nasync () => await p;',
  typescript:  'interface Foo<T> { bar: string; }\ntype A = number | string;\nenum E { A, B }\n@dec\nclass C<T> implements Foo<T> { private x: T; }\nconst x: number = 1;',
  python:      'import os\n@decorator\ndef hello(name: str = "x", *args, **kw) -> None:\n    """doc"""\n    print(f"Hello {name}")\n    return [i for i in range(3)]',
  java:        'package a.b;\nimport static java.lang.Math.PI;\nimport java.util.*;\n@Override\npublic class Main<T> { private static final int x = 0; String s = """\ntext\n"""; void m(String[] a) { return; } }',
  c:           '#include <stdio.h>\n#define N 10\nint main(void) { char *s = "hi"; int n = 0xFF; printf("%d", n); return 0; }',
  cpp:         '#include <iostream>\nclass B {};\nclass D : public B {};\ntemplate<typename T> class V { T x; };\nint main() { auto r = R"(raw)"; std::cout << "hi" << std::endl; auto v = new V<int>(); }',
  csharp:      'using System;\nnamespace N { [Attr] public class P { public int X { get; set; } static async Task Main() => await F(); } }',
  go:          'package main\nimport "fmt"\ntype T struct { X int }\nfunc main() { defer f(); go h(); fmt.Println("hi") }',
  rust:        'use std::fmt;\nmod m { pub fn f() {} }\ntype Alias = i32;\ntrait Tr { fn m(&self); }\n#[derive(Debug)]\nstruct S<\'a> { x: &\'a str }\nfn main() { let r = r"raw"; let mut x: i32 = 1; println!("{}", x); }',
  ruby:        'require "set"\nclass Foo\n  def greet(name)\n    @ivar = :sym\n    files = `ls -la`\n    Foo::Bar.new\n    re = /ab+/i\n    puts "Hello #{name}"\n  end\nend',
  php:         '<?php\nnamespace App;\n#[Route("/x")]\nclass Foo { public function greet(string $name): string { return "Hi $name"; } }\n$x = [1, 2];\ngreet(name: "a");',
  swift:       'import Foundation\n@objc class C: NSObject { var x: Int = 0; func greet(name: String) -> String { return "Hi \\(name)" } }',
  kotlin:      'package a\nimport kotlin.*\ndata class P(val x: Int)\nfun main() { val x = 1; println("$x"); listOf(1).map { it } }',
  sql:         '-- comment\nSELECT id, COUNT(*) AS n FROM "users" u JOIN orders o ON u.id = o.uid WHERE name = \'bob\' GROUP BY id ORDER BY n DESC;',
  html:        '<!DOCTYPE html>\n<!-- c -->\n<html lang="en"><head><meta charset="utf-8"></head><body><h1 class="t">Hi &amp; bye &lt;3&nbsp;end</h1></body></html>',
  css:         '/* c */\n:root { --v: 1px; }\nbody { margin: 0; color: #fff; background: rgb(0,0,0); }\n@media (min-width: 1px) { .a:hover { top: 1em; } }',
  json:        '{"name":"blok","version":1.0,"ok":true,"n":null,"keywords":["editor","rich"]}',
  yaml:        '%YAML 1.2\n---\n# comment\nname: blok\nversion: 1.0\nactive: null\nwhen: 2020-01-01\ntag: !!str x\nlist:\n  - a\n  - b\nmap:\n  key: &anchor val\n  ref: *anchor',
  markdown:    '# Title\n\n**Bold** and _italic_ with `code`.\n\n> quote\n\n---\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n- item\n\n![img](pic.png)\n\n[link](http://x.com)\n\n[ref]: http://y.com\n\n```js\nx\n```',
  bash:        '#!/bin/bash\n# comment\nX=1\nout=$(ls -la)\nexport VAR="$HOME/x"\nif [ -f file.txt ]; then\n  cat file.txt | grep -v x\nfi\nfunc() { echo $1; }',
  shell:       'echo "test" | grep -v "ignore" | wc -l && ls -la $HOME',
  dockerfile:  '# comment\nFROM node:18-alpine AS build\nENV X=1\nWORKDIR /app\nCOPY . .\nRUN npm install && npm run build\nCMD ["node", "x.js"]',
  xml:         '<?xml version="1.0"?>\n<!-- c -->\n<root xmlns:a="urn:x"><item id="1" a:k="v">text</item></root>',
  graphql:     '"""Docs"""\nquery GetUser($id: ID!) {\n  # comment\n  user(id: $id) @include(if: true) { name email ...Frag }\n}\nmutation M { update(id: 1) { ok } }\nfragment Frag on User { id }\nenum Color { RED GREEN }',
  r:           'x <- c(1, 2, 3)\n# comment\nf <- function(a, b=2) { mean(a) }\nplot(x, type="l")\nTRUE & FALSE',
  scala:       'package a\nimport scala.collection._\nobject Main extends App { val x: Int = 1; def f(y: Int) = y + 1; println(s"$x") }',
  dart:        'import "dart:io";\nclass P { final int x; P(this.x); }\nvoid main() async { final x = 1; await f(); print("$x"); }',
  lua:         '-- comment\nlocal function greet(name)\n  local t = {1, 2}\n  print("Hello " .. name)\n  return nil\nend',
  latex:       '\\documentclass{article}\n% comment\n\\usepackage{amsmath}\n\\begin{document}\n\\section{Intro}\n$E = mc^2$\n\\textbf{Hello}\n\\end{document}',
};

/** Token classes whose color comes from a colored ancestor or sibling marker — never their own class. */
const MARKER_PREFIXES = ['language-', 'lang-'];

/** Parse `.token.foo` selectors out of a stylesheet rule string. */
function coveredClassesIn(...ruleStrings: string[]): Set<string> {
  const set = new Set<string>();
  const re = /\.token\.([a-zA-Z][\w-]*)/g;
  for (const rules of ruleStrings) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(rules)) !== null) set.add(m[1]);
  }
  return set;
}

/** Meaningful (non-marker, non-"token") classes on an element. */
function tokenClasses(el: Element): string[] {
  return Array.from(el.classList).filter(
    (c) => c !== 'token' && !MARKER_PREFIXES.some((p) => c.startsWith(p)),
  );
}

/** A token element is covered if one of its own classes has a rule, or any token ancestor's does. */
function isCovered(el: Element, root: Element, covered: Set<string>): boolean {
  if (tokenClasses(el).some((c) => covered.has(c))) return true;
  let ancestor: Element | null = el.parentElement;
  while (ancestor && ancestor !== root) {
    if (ancestor.classList.contains('token') && tokenClasses(ancestor).some((c) => covered.has(c))) {
      return true;
    }
    ancestor = ancestor.parentElement;
  }
  return false;
}

/** Joined class signatures of every emitted token that resolves to no color rule. */
function findOrphans(root: Element, covered: Set<string>): string[] {
  return Array.from(root.querySelectorAll('.token'))
    .map((el) => ({ el, classes: tokenClasses(el) }))
    .filter((x) => x.classes.length > 0 && !isCovered(x.el, root, covered))
    .map((x) => x.classes.join('.'));
}

const highlightableLangs = LANGUAGES
  .map((l) => l.id)
  .filter((id) => HIGHLIGHTABLE_LANGUAGES.has(id) && id !== 'mermaid');

describe('Prism theme coverage', () => {
  it('defines color rules in both light and dark stylesheets', () => {
    // Sanity: the dark sheet must scope every rule under `.dark`.
    expect(LIGHT_RULES).toContain('.blok-code .token.keyword');
    expect(DARK_RULES).toContain('.dark .blok-code .token.keyword');
  });

  it('leaves no token class without a color in either theme', async () => {
    const lightCovered = coveredClassesIn(LIGHT_RULES);
    const darkCovered = coveredClassesIn(DARK_RULES);

    const orphansLight: Record<string, string[]> = {};
    const orphansDark: Record<string, string[]> = {};

    for (const lang of highlightableLangs) {
      const code = SNIPPETS[lang] ?? 'hello world test 123';
      const html = await tokenizePrism(code, lang);
      expect(html, `Expected non-null tokenization for ${lang}`).not.toBeNull();

      const root = document.createElement('div');
      root.innerHTML = html ?? '';

      orphansLight[lang] = findOrphans(root, lightCovered);
      orphansDark[lang] = findOrphans(root, darkCovered);
    }

    // keep only languages with real orphans, deduped, for a readable failure payload
    const clean = (o: Record<string, string[]>): Record<string, string[]> =>
      Object.fromEntries(
        Object.entries(o)
          .filter(([, v]) => v.length > 0)
          .map(([k, v]) => [k, [...new Set(v)].sort()]),
      );

    expect({ light: clean(orphansLight), dark: clean(orphansDark) }).toEqual({
      light: {},
      dark: {},
    });
  });
});
