# docs/ — Blok documentation app

The docs are a separate React app with its own `package.json` (Vitest + React Testing Library).

## Reference-prose law

The reference pages — the `api`, `tools`, `presets` and `server` namespaces plus the non-promotional half of `migration` — are read by someone looking something up, not by someone being sold to. They are written to a different brief from the landing pages, and that brief is mechanically enforced by `docs/src/i18n/reference-prose.test.ts`. Read that file before writing reference copy; it states every threshold and why it is where it is.

**Body copy renders through `<Prose>`, whose grammar is four tokens wide** (`docs/src/components/common/Prose.tsx`):

- A blank line starts a new paragraph.
- `- ` starts a list item.
- Two spaces then `- ` starts a sub-item under the item above.
- Backticks mark a code span.

Nothing else renders. `**bold**`, `# heading`, `1. ` and `> ` reach the reader as literal characters, and consecutive non-blank lines join into one paragraph — so a paragraph break needs `\n\n`, not `\n`. A value that ignores the grammar arrives as one unbroken slab however long it is, which is the failure this whole section exists to prevent.

**When you add or edit a reference value:**

- Break anything past five sentences or sixty words into paragraphs, a list, or both.
- Keep a sentence under 34 words and a list item under four sentences. Past that, split the sentence or push the tail into sub-items.
- Never open a value with a list. A list with no lead-in has nothing to attach to.
- Never join two clauses with an em or en dash. Start a new sentence.
- Give the value the SAME block shape in `en.json` and `ru.json`. Restructuring one locale and not the other is the most common way this drifts.
- Render it with `<Prose>`, not `<Typo>`. `Typo` flattens a whole value into one paragraph and prints backticks literally.

**Where the English lives is not obvious.** A key can exist in `en.json` AND as a literal in a data module (`api-data.ts`, `tools-data.ts`, `presets-data.ts`, `server-data.ts`). `en.json` wins at the reader, so editing only the literal changes nothing on screen. Where both exist they must stay identical, pinned by `docs/src/components/api/api-data.ru-coverage.test.ts`. Edit both in the same change.

**Do not relax a threshold to make the guard pass.** Raising a number hides the debt across every value at once. Either fix the prose, or add a `LONG_SENTENCE_EXEMPT` entry whose value states what makes that one value an exception — an entry with no reason is a suppressed failure.

## Plans Directory

`docs/plans/` contains design documents for refactoring work. These are architectural plans, not implementation tasks.
