# html-cleaner goldens

Frozen output of `html-janitor` 2.0.4, the library Blok's own HTML cleaner replaces.
The new engine must give the same output for every entry, or the entry must be a
known hazard that the new engine fixes on purpose.

## Files

- `golden.json.gz`: the goldens (gzip, because a plain JSON file this size has run `tsc` out of memory).
- `deviations.json.gz`: what the new engine gives on the hazard entries where it differs from html-janitor on purpose. `html-cleaner.golden.test.ts` checks every other entry against `golden.json.gz` and these against this file.
- `configs.ts`: frozen copies of the tag maps. Nothing imports `src/`, so a tool can change its `sanitize` without moving the goldens.
- `tools/record.mjs`: the recorder.
- `tools/sources.json.gz`: the frozen inputs the recorder reads.

## What an entry is

Each entry is one engine call. It is not Blok's `clean()` wrapper.

```js
new HTMLJanitor({ tags: GOLDEN_CONFIGS[config] ?? GOLDEN_ODD_CONFIGS[config], ...options }).clean(input)
```

```json
{ "id": "fuzz:12", "source": "fuzz", "config": "blok:pasted-cell", "input": "…", "output": "…" }
{ "id": "probe:13", "source": "probe", "config": "odd:p-null", "input": "…", "throws": "TypeError: …", "hazard": ["throws"] }
```

- `config` is a key of `GOLDEN_CONFIGS`, or of `GOLDEN_ODD_CONFIGS` for maps the engine throws on or reads oddly.
- `options` is set only on two entries, with `keepNestedBlockElements: true`. Blok never sets this option, so a parity test can skip them.
- `source` is one of:
  - `upstream`: html-janitor's own test cases;
  - `probe`: branch probes for code its tests miss;
  - `purify`: DOMPurify's test payloads;
  - `realistic:<test file>`: HTML string literals from Blok's tests;
  - `fuzz`: seeded random inputs.
- `meta` holds the html-janitor, jsdom and Node versions used.
  - Colour rules run through jsdom's style parser, so a jsdom bump can change their output.
  - Thrown messages come from V8, so they can change with Node.
  - Neither change means the new engine is wrong.

## Hazards

`hazard` marks entries where the old output is unsafe or broken. They are found mechanically, from the output (and the input, for one tag):

- `on-handler`: an attribute starting with `on` survives.
- `proto-key`: a `<constructor>` tag, or a `constructor` / `__proto__` attribute, survives.
  - The engine looks rules up without an own-property check, and these maps inherit `Object.prototype`.
  - The new engine looks rules up by own key only.
- `template-content`: a `<template>` with content survives. The engine never walks template content.
- `foreign-script-text`: the input has `<script>` or `<style>` inside `<svg>`/`<math>`.
  - There the tag name is lowercase `script`, so the engine's `SCRIPT` check misses it and keeps what is inside.
- `clobbering-form`: the input has a `<form>` holding a control whose `name` or `id` is one of the form's own members (`nextSibling`, `attributes`…).
  - Browsers let that control shadow the member; jsdom does not. The new engine drops such a form whole.
- `unsafe-url-attr`: a URL attribute (`href`, `src`, `xlink:href`, `action`, `background`, an SVG `values` entry…) keeps a script or `data:` URL, or a `srcdoc` survives.
  - html-janitor never looked at values; the new engine removes them.
- `foreign-content`: the input has `<svg>` or `<math>`. The new engine drops the children of a tag it unwraps inside them, and an HTML `mglyph`/`malignmark`.
- `throws`: the engine threw.

A hazard entry is not a target to copy. The new engine may differ there on purpose.

## Re-record the deviations

After a deliberate engine change, read the new differences, then run:

```sh
HTML_CLEANER_DEVIATIONS_REWRITE=1 npx vitest run --project unit test/unit/components/utils/html-cleaner.golden.test.ts
```

It rewrites `deviations.json.gz` and still fails if a difference lands on an entry with no hazard, or leaves an event handler or script URL behind.

## Re-record

```sh
node --max-old-space-size=4096 test/fixtures/html-cleaner/tools/record.mjs
```

Once `html-janitor` is gone from `package.json`, install it first with `yarn add -D html-janitor@2.0.4`.
Record, then remove it again, leaving `package.json` and `yarn.lock` unchanged.
The fuzz seed is fixed, so two runs give byte-identical files.

Before writing, the recorder checks that every upstream case and probe still gives the output measured when they were harvested.
It stops if any differ.
