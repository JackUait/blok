# Markdown HTML sanitizer goldens

Frozen output of `sanitizeBlockHtml` (`src/markdown/sanitize-html.ts`) from the
DOMPurify 3.4.17 version of that file. A replacement sanitizer must give the
same bytes for every input here.

## Files

- `inputs.json.gz`: the frozen inputs. Built once by `tools/harvest.mjs`.
- `golden.json.gz`: one row per input:
  `{ id, kind, source, input, output, outputWithBase }`.
  - `output` is `sanitizeBlockHtml(input)`. This is the Ask AI path, which has no base URL.
  - `outputWithBase` is `sanitizeBlockHtml(input, 'https://github.com/owner/repo/blob/main/README.md')`. This is the file preview path.
  - `meta` records the dompurify and jsdom versions and the git blobs of `sanitize-html.ts` and `src/shared/sanitize-url.ts`.
- Both files are gzipped because `tsconfig.json` type-checks every `.json` file.

## Inputs

`kind: 'benign'` covers raw HTML blocks the way users write them. Each one is a string that `markdownToHtml` passed to `sanitizeBlockHtml`. Duplicates are removed, the first source is kept, and `seen` counts how many times the string appeared. The id is a hash of the input, so adding a case does not renumber the others.

- `repo-md:<path>`: Markdown files tracked in this repo, except `docs/plans/`.
- `pipeline-upstream`, `pipeline-realworld` and `pipeline-fuzz`: the Markdown pipeline golden inputs in `test/unit/markdown/engine/`. Fuzz cases are random fragments, not real READMEs.
- `hand:<n>`: html blocks the parser finds in the typical GitHub README patterns in `tools/hand-cases.mjs`.
- `hand-direct:<n>`: a hand case passed as is. It is added only when the parser does not hand that exact string over in one piece. A blank line splits the block, and a line that starts with inline HTML is escaped, not sanitised. These rows still cover the sanitizer's API, but no Markdown input reaches them.

`kind: 'hostile'` covers the 472 payloads from DOMPurify 3.4.17's own tests (tag `3.4.17`, commit a77a3e7, `test/fixtures/expect.mjs` and `test/test-suite.js`). DOMPurify is dual-licensed MPL-2.0 or Apache-2.0. Only the payload strings are kept. Their ids (`fx-*`, `ts-*`) follow the harvest that built them. Some payload strings appear more than once.

## Compare bytes under jsdom only

The goldens were serialised by jsdom 29.1.1. A browser may escape attribute values differently, so a byte comparison belongs in vitest/jsdom, not in Playwright.

## Re-recording

You should not need to. If you must:

1. Check out the DOMPurify version of `src/markdown/sanitize-html.ts`.
2. Make sure `node_modules/dompurify` is 3.4.17. mermaid depends on dompurify too, so it may still be there. If it is not, run `yarn add -D dompurify@3.4.17`, record, then remove it again.
3. Run `node tools/record.mjs`. It refuses other dompurify or jsdom versions. Two runs give identical bytes.

Do not re-run `tools/harvest.mjs` unless you mean to change the corpus. It reads the live repo files and a payload list that is not stored here.

## Safety audit

`node tools/audit.mjs` reparses every output and fails on any of these:

- a tag outside the allowlist, or a tag outside the HTML namespace
- an `on*`, `style` or `data-*` attribute
- a `javascript:`, `vbscript:` or `data:text` URL
- an `<a href>` without `target="_blank"` and `rel="noopener noreferrer nofollow"`
- an output that changes when it is sanitised again

It sanitises with whatever `src/markdown/sanitize-html.ts` holds, so after the rewrite it checks the new sanitizer.
