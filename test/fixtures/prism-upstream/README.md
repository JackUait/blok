# Prism upstream test cases

Copied unchanged from PrismJS v1.30.0 (`tests/languages`, commit 76dde18), MIT License (see `LICENSE`).

Only the directories whose languages Blok ships are here. A directory name lists the languages to load. The main language is the one marked `!`, or else the last one.

`test/unit/tools/code/highlight/upstream-languages.test.ts` runs them against Blok's highlighter.

`grammar-structure.json` and `golden-html.json` are frozen output of the real Prism 1.30.0. `tools/regen.sh` rebuilds both. prismjs is not a dependency, so install it temporarily first (`yarn add -D prismjs@1.30.0`), run the script, then remove it again. On an unchanged tree the rebuild is byte-identical.
