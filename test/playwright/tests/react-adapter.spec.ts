import { test, expect, type Page } from '@playwright/test';
import { ensureBlokBundleBuilt } from './helpers/ensure-build';

const REACT_TEST_URL = 'http://localhost:4444/test/playwright/fixtures/react-test.html';

test.describe('React adapter', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test('should render a functional editor and support save', async ({ page }) => {
    await page.goto(REACT_TEST_URL);

    // Wait for editor to be ready
    await expect(page.getByTestId('status')).toHaveText('ready');

    // Editor should be visible
    const editorContainer = page.getByTestId('editor-container');

    await expect(editorContainer).toBeVisible();

    // The Blok editor wrapper should exist inside the container
    await expect(editorContainer.locator('[data-blok-editor]')).toBeVisible();

    // There should be an editable paragraph with initial content
    const paragraph = editorContainer.locator('[contenteditable="true"]').filter({ hasText: 'Hello from React' });

    await expect(paragraph).toBeVisible();
    await expect(paragraph).toContainText('Hello from React');

    // Type additional text
    await paragraph.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' - E2E test');

    // Save and check output
    await page.getByTestId('save').click();
    await expect(page.getByTestId('output')).toContainText('Hello from React - E2E test');
  });

  test('should toggle readOnly', async ({ page }) => {
    await page.goto(REACT_TEST_URL);
    await expect(page.getByTestId('status')).toHaveText('ready');

    // Editor should initially be editable
    const editorContainer = page.getByTestId('editor-container');
    const paragraph = editorContainer.locator('[contenteditable]').filter({ hasText: 'Hello from React' });

    await expect(paragraph).toHaveAttribute('contenteditable', 'true');

    // Toggle readOnly
    await page.getByTestId('toggle-readonly').click();

    // Editor should become non-editable
    await expect(paragraph).toHaveAttribute('contenteditable', 'false');
  });

  // --- Real-editor verification of useBlocks block creation (NO fakes) ---
  // These drive the genuine useBlocks API (bound to the real built editor via
  // window.__blocksApi) and assert through editor.save(), so they exercise the
  // real editor.blocks.insert / insertMany / setBlockParent pipeline end to end
  // — proving the fixes hold against real core, not a hand-written test harness.

  type SavedBlock = {
    id: string;
    type: string;
    data: { text?: string };
    parent?: string;
    content?: string[];
  };

  const readSavedBlocks = async (page: Page): Promise<SavedBlock[]> => {
    await page.getByTestId('save').click();
    const raw = await page.getByTestId('output').textContent();

    return (JSON.parse(raw ?? '{"blocks":[]}') as { blocks: SavedBlock[] }).blocks;
  };

  test('useBlocks.insertTree builds a REAL nested block tree (real insertMany)', async ({ page }) => {
    await page.goto(REACT_TEST_URL);
    await expect(page.getByTestId('status')).toHaveText('ready');

    const rootId = await page.evaluate(() => {
      const api = (window as unknown as {
        __blocksApi: { insertTree: (s: unknown) => { id: string } | null };
      }).__blocksApi;
      const root = api.insertTree({
        type: 'header',
        data: { text: 'Parent' },
        children: [
          { type: 'paragraph', data: { text: 'Child A' } },
          { type: 'paragraph', data: { text: 'Child B' } },
        ],
      });

      return root?.id ?? null;
    });

    expect(rootId).not.toBeNull();

    const blocks = await readSavedBlocks(page);
    const parent = blocks.find((b) => b.type === 'header' && b.data.text === 'Parent');

    expect(parent).toBeDefined();
    if (parent === undefined) {
      throw new Error('inserted header root not found in saved output');
    }

    // Real nesting: exactly the two children name the header as their parent in
    // the genuine saved tree (Saver derives `parent` from real block.parentId).
    const children = blocks.filter((b) => b.parent === parent.id);

    expect(children.map((b) => b.data.text).sort()).toEqual(['Child A', 'Child B']);
  });

  test('a bulk insertTree re-renders a getChildren-reading component (reactivity end-to-end)', async ({ page }) => {
    await page.goto(REACT_TEST_URL);
    await expect(page.getByTestId('status')).toHaveText('ready');

    // The fixture's root-count is derived in render from blocks.getChildren(null).
    // It starts at 1 (the seeded block1) and must update to 2 after a bulk
    // insertTree WITHOUT any save/click — proving editor.blocks.insertMany now
    // emits 'block changed' so useBlocks re-renders. (Pre-fix it stayed at 1.)
    await expect(page.getByTestId('root-count')).toHaveText('1');

    await page.evaluate(() => {
      const api = (window as unknown as {
        __blocksApi: { insertTree: (s: unknown) => unknown };
      }).__blocksApi;

      api.insertTree({ type: 'header', data: { text: 'Reactive' } });
    });

    await expect(page.getByTestId('root-count')).toHaveText('2');
  });

  test('a programmatic insert renders a new block holder in the React-managed container', async ({ page }) => {
    await page.goto(REACT_TEST_URL);
    await expect(page.getByTestId('status')).toHaveText('ready');

    const editorContainer = page.getByTestId('editor-container');
    const editables = editorContainer.locator('[contenteditable]');

    await expect(editables).toHaveCount(1);

    await page.evaluate(() => {
      const api = (window as unknown as {
        __blocksApi: { insert: (s: unknown) => unknown };
      }).__blocksApi;

      api.insert({ type: 'paragraph', data: { text: 'Programmatically added' }, position: 'end' });
    });

    // The created block's holder is adopted into the same React-managed container
    // and rendered — a real DOM node, not just a saved-model entry.
    await expect(editables).toHaveCount(2);
    await expect(editorContainer.getByText('Programmatically added')).toBeVisible();
  });

  test('an end-user Enter-split gesture creates and renders a second block through the React mount', async ({ page }) => {
    await page.goto(REACT_TEST_URL);
    await expect(page.getByTestId('status')).toHaveText('ready');

    const editorContainer = page.getByTestId('editor-container');
    const firstParagraph = editorContainer.locator('[contenteditable]').first();

    await firstParagraph.click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Second block');

    // The split produced a real second block in the React-mounted editor.
    await expect(editorContainer.locator('[contenteditable]')).toHaveCount(2);

    const blocks = await readSavedBlocks(page);

    expect(blocks).toHaveLength(2);
    expect(blocks[1].data.text).toBe('Second block');
  });

  test('useBlocks move/nest/unnest/remove/update/convert run against the real bundle', async ({ page }) => {
    await page.goto(REACT_TEST_URL);
    await expect(page.getByTestId('status')).toHaveText('ready');

    await page.evaluate(() => {
      const api = (window as unknown as {
        __blocksApi: {
          insert: (s: unknown) => { id: string } | null;
          nest: (id: string, parentId: string) => void;
          unnest: (id: string) => void;
          move: (id: string, target: unknown) => void;
          update: (id: string, data: unknown) => void;
          convert: (id: string, type: string) => void;
          remove: (id: string) => void;
        };
      }).__blocksApi;

      api.insert({ type: 'paragraph', id: 'A', data: { text: 'Parent' }, position: 'end' });
      api.insert({ type: 'paragraph', id: 'B', data: { text: 'Child' }, position: 'end' });
      api.insert({ type: 'paragraph', id: 'C', data: { text: 'Doomed' }, position: 'end' });
      api.insert({ type: 'paragraph', id: 'D', data: { text: 'Mover' }, position: 'end' });
      api.insert({ type: 'paragraph', id: 'E', data: { text: 'Temp' }, position: 'end' });

      api.nest('B', 'A');               // nest:   B becomes a child of A
      api.nest('E', 'A');               // (set up an unnest target)
      api.unnest('E');                  // unnest: E promoted back to root
      api.move('D', { before: 'A' });   // move:   D relocated before A
      api.update('A', { text: 'Parent updated' }); // update: A's text
      api.convert('B', 'header');       // convert: B -> header (new id, kept under A)
      api.remove('C');                  // remove:  delete the throwaway block
    });

    const blocks = await readSavedBlocks(page);
    const indexOf = (id: string): number => blocks.findIndex((b) => b.id === id);
    const parent = blocks.find((b) => b.id === 'A');
    // convert() recreates the block under a fresh id, so locate the converted
    // child by its NEW type + preserved parent link rather than the old id.
    const convertedChild = blocks.find((b) => b.type === 'header' && b.parent === 'A');

    // update
    expect(parent?.data.text).toBe('Parent updated');
    // nest + convert: the (retyped) child still names A as its parent.
    expect(convertedChild).toBeDefined();
    expect(convertedChild?.data.text).toBe('Child');
    // unnest: E is back at root (no parent link).
    expect(blocks.find((b) => b.id === 'E')?.parent ?? null).toBeNull();
    // move: D now sits before A in document order.
    expect(indexOf('D')).toBeLessThan(indexOf('A'));
    // remove: C is gone.
    expect(blocks.find((b) => b.id === 'C')).toBeUndefined();
  });

  test('useBlocks.insertMarkdown creates REAL blocks from markdown (real bundle, real converter)', async ({ page }) => {
    await page.goto(REACT_TEST_URL);
    await expect(page.getByTestId('status')).toHaveText('ready');

    // Exercises the lazy dynamic import of the markdown converter in the REAL
    // built bundle — a broken chunk path would throw here, which a unit test
    // against a fake editor.blocks could never catch.
    const created = await page.evaluate(async () => {
      const api = (window as unknown as {
        __blocksApi: { insertMarkdown: (md: string) => Promise<Array<{ id: string }>> };
      }).__blocksApi;
      const nodes = await api.insertMarkdown('# Hello\n\nWorld');

      return nodes.length;
    });

    expect(created).toBe(2);

    const blocks = await readSavedBlocks(page);

    expect(blocks.some((b) => b.type === 'header' && b.data.text === 'Hello')).toBe(true);
    expect(blocks.some((b) => b.type === 'paragraph' && b.data.text === 'World')).toBe(true);
  });

  test('useBlocks.insert replace of a ROOT block stays at root, not nested (bug fix)', async ({ page }) => {
    await page.goto(REACT_TEST_URL);
    await expect(page.getByTestId('status')).toHaveText('ready');

    await page.evaluate(() => {
      const api = (window as unknown as {
        __blocksApi: { insert: (s: unknown) => { id: string } | null };
      }).__blocksApi;

      // A second root block to (wrongly, under the bug) nest the replacement under.
      api.insert({ type: 'paragraph', id: 'anchor', data: { text: 'anchor' }, position: 'end' });
      // Turn the initial root paragraph 'block1' into a header while passing a
      // parentId. The replaced block lives at root, so the replacement must keep
      // a null parent — the pre-fix code adopted the caller's parentId ('anchor').
      api.insert({
        type: 'header',
        data: { text: 'TURNED' },
        replace: true,
        position: { before: 'block1' },
        parentId: 'anchor',
      });
    });

    const blocks = await readSavedBlocks(page);
    const turned = blocks.find((b) => b.type === 'header' && b.data.text === 'TURNED');

    expect(turned).toBeDefined();
    if (turned === undefined) {
      throw new Error('replaced (turned) block not found in saved output');
    }

    // The replacement must remain at ROOT — not adopted under 'anchor'.
    expect(turned.parent ?? null).toBeNull();
  });
});

test.describe('BlokEditor component', () => {
  const URL = 'http://localhost:4444/test/playwright/fixtures/blok-editor.html';

  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test('saves via ref and survives theme/width/readOnly toggles', async ({ page }) => {
    await page.goto(URL);
    await expect(page.getByTestId('status')).toHaveText('ready');

    const host = page.getByTestId('editor-host');
    const paragraph = host.locator('[contenteditable="true"]').filter({ hasText: 'Hello from BlokEditor' });
    await expect(paragraph).toBeVisible();

    // Type, then toggle theme + width — content must survive (no remount)
    await paragraph.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' - kept');
    await page.getByTestId('toggle-theme').click();
    await page.getByTestId('toggle-width').click();
    await expect(host.locator('[contenteditable]')).toContainText('Hello from BlokEditor - kept');

    // Save via the imperative ref
    await page.getByTestId('save').click();
    await expect(page.getByTestId('output')).toContainText('Hello from BlokEditor - kept');

    // readOnly toggle still works
    await page.getByTestId('toggle-readonly').click();
    await expect(host.locator('[contenteditable]').first()).toHaveAttribute('contenteditable', 'false');
  });

  test('forwards id (and other div props) to the editor container element', async ({ page }) => {
    await page.goto(URL);
    await expect(page.getByTestId('status')).toHaveText('ready');

    // Both id and data-blok-testid passed to <BlokEditor> land on the same container,
    // which holds the editor DOM — proving arbitrary div props are forwarded.
    const container = page.getByTestId('editor-container');
    await expect(container).toHaveAttribute('id', 'editor-entry-point');
    await expect(container.locator('[data-blok-editor]')).toBeVisible();
  });

  test('placeholder is reactive end-to-end (real cross-module chain, no remount)', async ({ page }) => {
    await page.goto(URL);
    await expect(page.getByTestId('status')).toHaveText('ready');

    const host = page.getByTestId('editor-host');
    const paragraph = host.locator('[contenteditable="true"]').filter({ hasText: 'Hello from BlokEditor' });
    await expect(paragraph).toBeVisible();

    // The editor-level placeholder is applied to the default paragraph block.
    await expect(paragraph).toHaveAttribute('data-blok-placeholder-active', 'First placeholder');

    // Changing the placeholder prop updates the live DOM attribute through the full
    // chain (editor.placeholder.set → BlockManager → Block → Paragraph) without remount.
    await page.getByTestId('toggle-placeholder').click();
    await expect(paragraph).toHaveAttribute('data-blok-placeholder-active', 'Second placeholder');

    // Content survived (no recreation), proving an in-place update.
    await expect(paragraph).toContainText('Hello from BlokEditor');
  });
});
