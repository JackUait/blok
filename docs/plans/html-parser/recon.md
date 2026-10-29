# Recon: parse5 8.0.1 → src/html

Target: inikulin/parse5 v8.0.1 (MIT), packages/parse5/lib only. Source read from the v8.0.1 tag.

## Modules (lines of TS)

| upstream | lines | what we do |
|---|---|---|
| tokenizer/index.ts + preprocessor.ts | 2932 + 248 | rewrite: state machine with sticky-regex runs in hot states |
| parser/index.ts | 3705 | port, keep structure diffable |
| parser/open-element-stack.ts, formatting-element-list.ts | 394 + 159 | port |
| common/foreign-content.ts, doctype.ts | 255 + 135 | port |
| common/html.ts | 571 | ported to src/html/tags.ts (generated tables) |
| common/token.ts | 104 | src/html/token.ts, no locations |
| tree-adapters/default.ts | 314 | src/html/tree.ts, plain functions |
| serializer/index.ts | 231 | port |
| common/error-codes.ts, unicode.ts | 70 + 71 | error codes skipped |
| entities package (decode trie, escape) | — | own decoder over src/markdown/engine/entities.ts + legacy list |

## Jint cost split (measured 2026-10-29, Jint 4.17, one marked inline field)

- parse5 tokenizer alone: 577–694 µs; parseFragment: 705–1076 µs; serialize: 80–107 µs; parseFragment('x'): 30–40 µs.
- One 200-field document: tokenizer ≈ 70% of parse time.
- So a regex tokenizer alone caps at ≈ 2.5×. More needs a lean tree-builder path for common in-body tokens.

## Test suites taken from upstream

- html5lib-tests @ a9f44960: tokenizer (14 files, 6810 cases), tree-construction (56 .dat, 1681 cases; 27 #script-off skipped; scripted/ skipped).
- html5lib-tests fork @ 11c3216c (parse5's primary suite): 53 .dat, 1614 cases, deduped against upstream; parse5's 6 known-outdated foreign-fragment cases expected to fail.
- parse5 serialization tests.json; parse5 regression tests (rawtext breakout, DOCTYPE empty fields, prototype pollution, template/void serialization).

## Matrix

See features.csv (must / skip with reasons).
