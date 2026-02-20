# Google Docs Paste Preprocessing Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Move Google Docs style conversion before the first sanitization pass so bold, italic, and line breaks survive when pasting tables from Google Docs.

**Architecture:** Extract Google Docs preprocessing into a standalone utility (`google-docs-preprocessor.ts`), call it in the paste module's `getDataForHandler()` before `clean()`, and remove the now-redundant methods from `HtmlHandler`.

**Tech Stack:** TypeScript, DOMParser, existing `clean()` sanitizer

---

### Task 1: Write failing test for the real paste flow

**Files:**
- Modify: `test/unit/components/modules/paste.test.ts`

**Step 1: Add a test that exercises `processDataTransfer` with Google Docs HTML**

The existing tests use `paste.processText(html, true)` which bypasses `getDataForHandler()` and its first `clean()` call. We need a test that goes through `processDataTransfer()` to prove the bug exists.

Add this test at the end of the `HtmlHandler` describe block (after the existing tests, around line 1156):

```typescript
    it('preserves Google Docs bold/italic formatting through processDataTransfer', async () => {
      const { paste, mocks } = createPaste();

      const defaultTool = {
        name: 'paragraph',
        pasteConfig: {},
        baseSanitizeConfig: {},
        hasOnPasteHandler: true,
      } as unknown as BlockToolAdapter;

      mocks.Tools.defaultTool = defaultTool;
      mocks.Tools.blockTools.set('paragraph', defaultTool);
      mocks.Tools.getAllInlineToolsSanitizeConfig.mockReturnValue({ b: {}, i: {}, a: { href: true } });

      await paste.prepare();

      mocks.BlockManager.currentBlock = {
        tool: { isDefault: true },
        isEmpty: true,
      };
      mocks.BlockManager.setCurrentBlockByChildNode.mockReturnValue(mocks.BlockManager.currentBlock);
      mocks.BlockManager.paste.mockReturnValue({ id: 'block-id' });

      const googleDocsHtml = '<b id="docs-internal-guid-abc123"><div><span style="font-weight:700">bold text</span> and <span style="font-style:italic">italic text</span></div></b>';

      const dataTransfer = {
        getData: vi.fn((type: string) => {
          if (type === 'text/html') return googleDocsHtml;
          if (type === 'text/plain') return 'bold text and italic text';
          return '';
        }),
        types: ['text/html', 'text/plain'],
        files: [],
      } as unknown as DataTransfer;

      await paste.processDataTransfer(dataTransfer);

      expect(mocks.BlockManager.paste).toHaveBeenCalled();

      const [, event] = mocks.BlockManager.paste.mock.calls[0];
      const detail = event.detail as { data: HTMLElement };

      expect(detail.data.innerHTML).toContain('<b>');
      expect(detail.data.innerHTML).toContain('<i>');
    });
```

**Step 2: Run test to verify it fails**

Run: `yarn test test/unit/components/modules/paste.test.ts`

Expected: The new test FAILS because the first `clean()` call in `getDataForHandler()` strips the `<span>` tags before `convertGoogleDocsStyles()` can convert them.

**Step 3: Commit failing test**

```bash
git add test/unit/components/modules/paste.test.ts
git commit -m "test(paste): add failing test for Google Docs formatting through processDataTransfer"
```

---

### Task 2: Create preprocessor and wire into paste module

**Files:**
- Create: `src/components/modules/paste/google-docs-preprocessor.ts`
- Modify: `src/components/modules/paste/index.ts:200-210`

**Step 1: Create the preprocessor utility**

Create `src/components/modules/paste/google-docs-preprocessor.ts`:

```typescript
/**
 * Pre-process Google Docs clipboard HTML before sanitization.
 *
 * Google Docs wraps content in `<b id="docs-internal-guid-...">` and
 * encodes formatting as inline styles on `<span>` elements rather than
 * semantic tags.  The sanitizer strips `<span>` (not in the allowed
 * config), destroying formatting.  This function converts style-based
 * spans to `<b>`/`<i>` BEFORE the sanitizer runs.
 *
 * @param html - raw clipboard HTML string
 * @returns preprocessed HTML string
 */
export function preprocessGoogleDocsHtml(html: string): string {
  const wrapper = document.createElement('div');

  wrapper.innerHTML = html;

  unwrapGoogleDocsContent(wrapper);
  convertGoogleDocsStyles(wrapper);

  return wrapper.innerHTML;
}

/**
 * Strip Google Docs wrapper elements to expose underlying content.
 * Google Docs wraps clipboard HTML in `<b id="docs-internal-guid-..."><div>...</div></b>`.
 * The sanitizer strips the `id` attribute (config is `b: {}`), making
 * the wrapper undetectable later in the pipeline.
 */
function unwrapGoogleDocsContent(wrapper: HTMLElement): void {
  const googleDocsWrapper = wrapper.querySelector<HTMLElement>('b[id^="docs-internal-guid-"]');

  if (!googleDocsWrapper) {
    return;
  }

  const contentSource = googleDocsWrapper.querySelector<HTMLElement>(':scope > div') ?? googleDocsWrapper;
  const fragment = document.createDocumentFragment();

  while (contentSource.firstChild) {
    fragment.appendChild(contentSource.firstChild);
  }

  googleDocsWrapper.replaceWith(fragment);
}

/**
 * Convert Google Docs style-based `<span>` elements to semantic HTML tags.
 *
 * - `<span style="font-weight:700">` or `font-weight:bold` → `<b>`
 * - `<span style="font-style:italic">` → `<i>`
 */
function convertGoogleDocsStyles(wrapper: HTMLElement): void {
  for (const span of Array.from(wrapper.querySelectorAll('span[style]'))) {
    const style = span.getAttribute('style') ?? '';
    const isBold = /font-weight\s*:\s*(700|bold)/i.test(style);
    const isItalic = /font-style\s*:\s*italic/i.test(style);

    if (!isBold && !isItalic) {
      continue;
    }

    const inner = span.innerHTML;
    const italic = isItalic ? `<i>${inner}</i>` : inner;
    const wrapped = isBold ? `<b>${italic}</b>` : italic;

    span.replaceWith(document.createRange().createContextualFragment(wrapped));
  }
}
```

**Step 2: Wire preprocessor into paste module**

In `src/components/modules/paste/index.ts`, add import at top:

```typescript
import { preprocessGoogleDocsHtml } from './google-docs-preprocessor';
```

In `getDataForHandler()`, replace line 210:

```typescript
    const cleanData = clean(rawHtmlData, customConfig);
```

with:

```typescript
    const preprocessed = preprocessGoogleDocsHtml(rawHtmlData);
    const cleanData = clean(preprocessed, customConfig);
```

**Step 3: Run test to verify it passes**

Run: `yarn test test/unit/components/modules/paste.test.ts`

Expected: The new test PASSES. All existing tests also pass.

**Step 4: Commit**

```bash
git add src/components/modules/paste/google-docs-preprocessor.ts src/components/modules/paste/index.ts
git commit -m "fix(paste): preprocess Google Docs styles before first sanitization

Move Google Docs style span conversion (font-weight:700 → <b>,
font-style:italic → <i>) to run BEFORE the sanitizer strips <span> tags.
Previously, the first clean() call in getDataForHandler() destroyed the
style spans before HtmlHandler.convertGoogleDocsStyles() could convert them."
```

---

### Task 3: Remove duplicate methods from HtmlHandler

**Files:**
- Modify: `src/components/modules/paste/handlers/html-handler.ts`
- Modify: `test/unit/components/modules/paste.test.ts`

**Step 1: Remove methods from HtmlHandler**

In `src/components/modules/paste/handlers/html-handler.ts`:

1. Remove the calls in `processHTML()` (lines 67-68):
   ```typescript
   this.unwrapGoogleDocsContent(wrapper);
   this.convertGoogleDocsStyles(wrapper);
   ```

2. Remove the `unwrapGoogleDocsContent()` private method (lines 182-202)

3. Remove the `convertGoogleDocsStyles()` private method (lines 204-228)

**Step 2: Update existing tests**

The two existing tests `'converts Google Docs style spans to semantic tags before sanitization'` and `'converts Google Docs bold+italic combo span to nested semantic tags'` use `paste.processText(html, true)` which now bypasses the preprocessing (it goes directly to `HtmlHandler.handle()`, not through `getDataForHandler()`).

These tests should be **removed** since:
- They test functionality that no longer exists in `HtmlHandler`
- The new test from Task 1 already covers the same behavior through the correct code path

Remove the two tests (approximately lines 1084-1156 in the test file).

**Step 3: Run tests**

Run: `yarn test test/unit/components/modules/paste.test.ts`

Expected: All tests pass.

**Step 4: Commit**

```bash
git add src/components/modules/paste/handlers/html-handler.ts test/unit/components/modules/paste.test.ts
git commit -m "refactor(paste): remove duplicate Google Docs preprocessing from HtmlHandler

The style conversion now runs in the paste module before sanitization.
The HtmlHandler methods are no longer needed."
```

---

### Task 4: Add unit tests for the preprocessor utility

**Files:**
- Create: `test/unit/components/modules/paste/google-docs-preprocessor.test.ts`

**Step 1: Write tests**

```typescript
import { describe, it, expect } from 'vitest';
import { preprocessGoogleDocsHtml } from '../../../../../src/components/modules/paste/google-docs-preprocessor';

describe('preprocessGoogleDocsHtml', () => {
  it('converts bold style spans to <b> tags', () => {
    const html = '<span style="font-weight:700">bold text</span>';
    const result = preprocessGoogleDocsHtml(html);

    expect(result).toContain('<b>bold text</b>');
  });

  it('converts italic style spans to <i> tags', () => {
    const html = '<span style="font-style:italic">italic text</span>';
    const result = preprocessGoogleDocsHtml(html);

    expect(result).toContain('<i>italic text</i>');
  });

  it('converts bold+italic combo spans to nested <b><i> tags', () => {
    const html = '<span style="font-weight:700;font-style:italic">both</span>';
    const result = preprocessGoogleDocsHtml(html);

    expect(result).toContain('<b><i>both</i></b>');
  });

  it('handles font-weight:bold keyword', () => {
    const html = '<span style="font-weight:bold">bold text</span>';
    const result = preprocessGoogleDocsHtml(html);

    expect(result).toContain('<b>bold text</b>');
  });

  it('unwraps Google Docs <b id="docs-internal-guid-..."> wrapper', () => {
    const html = '<b id="docs-internal-guid-abc123"><div><p>content</p></div></b>';
    const result = preprocessGoogleDocsHtml(html);

    expect(result).not.toContain('docs-internal-guid');
    expect(result).toContain('content');
  });

  it('unwraps wrapper and converts styles together', () => {
    const html = '<b id="docs-internal-guid-abc"><div><span style="font-weight:700">bold</span></div></b>';
    const result = preprocessGoogleDocsHtml(html);

    expect(result).not.toContain('docs-internal-guid');
    expect(result).toContain('<b>bold</b>');
  });

  it('passes through non-Google-Docs HTML unchanged', () => {
    const html = '<p>regular paragraph</p>';
    const result = preprocessGoogleDocsHtml(html);

    expect(result).toBe('<p>regular paragraph</p>');
  });

  it('ignores spans without bold or italic styles', () => {
    const html = '<span style="color:red">red text</span>';
    const result = preprocessGoogleDocsHtml(html);

    expect(result).toContain('<span style="color:red">red text</span>');
  });
});
```

**Step 2: Run tests**

Run: `yarn test test/unit/components/modules/paste/google-docs-preprocessor.test.ts`

Expected: All tests pass.

**Step 3: Commit**

```bash
git add test/unit/components/modules/paste/google-docs-preprocessor.test.ts
git commit -m "test(paste): add unit tests for Google Docs preprocessor utility"
```

---

### Task 5: Run lint and full test suite

**Step 1: Run lint**

Run: `yarn lint`

Expected: No new lint errors. Fix any that appear.

**Step 2: Run full unit test suite**

Run: `yarn test`

Expected: All tests pass. No regressions.

**Step 3: Commit any fixes if needed**

```bash
git add -A
git commit -m "fix(paste): resolve lint errors from preprocessing changes"
```
