import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { BLOK_INTERFACE_SELECTOR } from "../../../../src/components/constants";
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from "../helpers/ensure-build";

/**
 * E2E regression specs for the Notion text/header parity keyboard bugs.
 *
 * NOTE: These exercise REAL caret/selection geometry (Shift+Arrow cross-block
 * selection, end-of-line detection, undo grouping) that jsdom cannot simulate —
 * the unit specs cover the branch logic with a mocked caret, these lock the
 * real-browser behaviour. They are NOT run as part of the unit suite.
 *
 *  - BUG #5  Shift+ArrowRight at the END (Shift+ArrowLeft at the START) of a
 *            block extends the selection into the adjacent block.
 *  - BUG #6  Enter in an empty quote converts it to a paragraph in place.
 *  - BUG #7  Forward-Delete in an empty styled block pulls the next block UP
 *            and keeps the styled type.
 *  - BUG #11 Backspace at the start of a NESTED list item outdents it.
 *  - BUG #12 Backspace before a non-mergeable previous block selects it.
 *  - BUG #16 Tab indentation is its own undo step.
 */

const HOLDER_ID = "blok-e2e-test";
const BLOCK_WRAPPER_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"]`;
const SELECTED_BLOCK_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-selected="true"]`;

const getBlockWrapperSelectorByIndex = (index: number): string => {
  return `:nth-match(${BLOCK_WRAPPER_SELECTOR}, ${index + 1})`;
};

/** A deliberately non-mergeable tool (no merge, no conversionConfig). */
const NON_MERGEABLE_TOOL = `(() => {
  return class Widget {
    static get toolbox() { return { icon: '', title: 'Widget' }; }
    constructor({ data }) { this._data = data || {}; }
    render() {
      const el = document.createElement('div');
      el.contentEditable = 'true';
      el.setAttribute('data-blok-testid', 'widget-content');
      el.textContent = this._data.text || 'widget';
      return el;
    }
    save(el) { return { text: el.textContent }; }
  };
})()`;

type BlokSetupOptions = {
  data?: Record<string, unknown>;
  tools?: Array<{ name: string; classSource: string }>;
};

const resetBlok = async (page: Page): Promise<void> => {
  await page.evaluate(
    async ({ holder }) => {
      if (window.blokInstance) {
        await window.blokInstance.destroy?.();
        window.blokInstance = undefined;
      }
      const existing = document.getElementById(holder);
      if (existing) existing.remove();
      const container = document.createElement("div");
      container.id = holder;
      container.setAttribute("data-blok-testid", holder);
      document.body.appendChild(container);
    },
    { holder: HOLDER_ID },
  );
};

const createBlok = async (page: Page, options: BlokSetupOptions = {}): Promise<void> => {
  const { data, tools = [] } = options;

  await resetBlok(page);
  // eslint-disable-next-line playwright/no-wait-for-selector -- the holder is empty (zero-size) until Blok mounts, so wait for attachment, not visibility
  await page.waitForSelector(`#${HOLDER_ID}`, { state: "attached" });
  await page.waitForFunction(() => typeof window.Blok === "function");

  await page.evaluate(
    async ({ holder, rawData, serializedTools }) => {
      const revive = (classSource: string): unknown =>
        // eslint-disable-next-line no-new-func, @typescript-eslint/no-unsafe-call -- dynamic tool class for tests
        new Function(`return (${classSource});`)();

      const revivedTools: Record<string, Record<string, unknown>> = Object.fromEntries(
        serializedTools.map((t) => [t.name, { class: revive(t.classSource) }]),
      );

      const blok = new window.Blok({
        holder,
        ...(serializedTools.length > 0 ? { tools: revivedTools } : {}),
        ...(rawData ? { data: rawData } : {}),
      });

      window.blokInstance = blok;
      await blok.isReady;
    },
    { holder: HOLDER_ID, rawData: data ?? null, serializedTools: tools },
  );
};

const focusBlockAtIndex = async (page: Page, index: number): Promise<void> => {
  await page.locator(getBlockWrapperSelectorByIndex(index)).locator('[contenteditable="true"]').first().click();
};

test.describe("Notion keyboard parity bugs", () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
  });

  test("BUG #5 — Shift+ArrowRight at the end of a block extends the selection into the next block", async ({ page }) => {
    await createBlok(page, {
      data: {
        blocks: [
          { type: "paragraph", data: { text: "Hello" } },
          { type: "paragraph", data: { text: "World" } },
        ],
      },
    });

    await focusBlockAtIndex(page, 0);
    await page.keyboard.press("End");
    await page.keyboard.press("Shift+ArrowRight");

    // The caret did NOT collapse into the next block — instead a cross-block
    // selection now spans both blocks.
    await expect(page.locator(SELECTED_BLOCK_SELECTOR)).toHaveCount(2);
  });

  test("BUG #5 — Shift+ArrowLeft at the start of a block extends the selection into the previous block", async ({ page }) => {
    await createBlok(page, {
      data: {
        blocks: [
          { type: "paragraph", data: { text: "Hello" } },
          { type: "paragraph", data: { text: "World" } },
        ],
      },
    });

    await focusBlockAtIndex(page, 1);
    await page.keyboard.press("Home");
    await page.keyboard.press("Shift+ArrowLeft");

    await expect(page.locator(SELECTED_BLOCK_SELECTOR)).toHaveCount(2);
  });

  test("BUG #6 — Enter in an empty quote converts it to a paragraph in place", async ({ page }) => {
    await createBlok(page, {
      data: {
        blocks: [{ type: "quote", data: { text: "", size: "default" } }],
      },
    });

    await focusBlockAtIndex(page, 0);
    await page.keyboard.press("Enter");

    /**
     * The empty quote is converted to a paragraph IN PLACE — still exactly one
     * block, now a paragraph. We assert via the live blocks API rather than
     * save(), because save() validly drops the now-empty paragraph
     * (paragraph.validate() returns false for blank text).
     */
    const result = await page.evaluate(() => {
      const inst = window.blokInstance;

      return {
        firstName: inst?.blocks.getBlockByIndex(0)?.name ?? null,
        hasSecond: inst?.blocks.getBlockByIndex(1) != null,
      };
    });

    expect(result.firstName).toBe("paragraph");
    expect(result.hasSecond).toBe(false);
  });

  test("BUG #7 — forward-Delete in an empty heading pulls the next paragraph up and keeps the heading", async ({ page }) => {
    await createBlok(page, {
      data: {
        blocks: [
          { type: "header", data: { text: "", level: 1 } },
          { type: "paragraph", data: { text: "Body text" } },
        ],
      },
    });

    await focusBlockAtIndex(page, 0);
    await page.keyboard.press("Delete");

    const saved = await page.evaluate(async () => {
      if (!window.blokInstance) return null;
      return window.blokInstance.save();
    });

    // The styled (heading) block wins: it absorbs the paragraph's text.
    expect(saved?.blocks).toHaveLength(1);
    expect(saved?.blocks[0].type).toBe("header");
    expect(saved?.blocks[0].data.text).toContain("Body text");
  });

  test("BUG #11 — Backspace at the start of a nested list item outdents it one level", async ({ page }) => {
    await createBlok(page, {
      data: {
        blocks: [
          { type: "list", data: { text: "Parent", style: "unordered" } },
          { type: "list", data: { text: "Child", style: "unordered" } },
        ],
      },
    });

    // Nest the second item under the first via keyboard Tab (structural nesting).
    await focusBlockAtIndex(page, 1);
    await page.keyboard.press("Home");
    await page.keyboard.press("Tab");

    const parentIdAfterNest = await page.evaluate(() => {
      const block = window.blokInstance?.blocks.getBlockByIndex(1);
      return block?.parentId ?? null;
    });
    expect(parentIdAfterNest).not.toBeNull();

    // Backspace at the start now OUTDENTS instead of converting to a paragraph.
    await page.keyboard.press("Home");
    await page.keyboard.press("Backspace");

    const stillList = await page.evaluate(async () => {
      if (!window.blokInstance) return null;
      const saved = await window.blokInstance.save();
      return saved.blocks[1]?.type ?? null;
    });
    const parentIdAfterOutdent = await page.evaluate(() => {
      const block = window.blokInstance?.blocks.getBlockByIndex(1);
      return block?.parentId ?? null;
    });

    // It is still a list item (NOT converted to a paragraph) and back at root.
    expect(stillList).toBe("list");
    expect(parentIdAfterOutdent).toBeNull();
  });

  test("BUG #12 — Backspace before a non-mergeable block selects it", async ({ page }) => {
    await createBlok(page, {
      data: {
        blocks: [
          { type: "widget", data: { text: "I am a widget" } },
          { type: "paragraph", data: { text: "Below" } },
        ],
      },
      tools: [{ name: "widget", classSource: NON_MERGEABLE_TOOL }],
    });

    await focusBlockAtIndex(page, 1);
    await page.keyboard.press("Home");
    await page.keyboard.press("Backspace");

    // The non-mergeable previous block is selected (a second Backspace deletes it).
    const firstWrapper = page.locator(getBlockWrapperSelectorByIndex(0));
    await expect(firstWrapper).toHaveAttribute("data-blok-selected", "true");
  });

  test("BUG #16 — Tab indentation is its own undo step (Cmd+Z reverts only the indent, not the typing)", async ({ page }) => {
    await createBlok(page, {
      data: {
        blocks: [
          { type: "paragraph", data: { text: "Anchor" } },
          { type: "paragraph", data: { text: "" } },
        ],
      },
    });

    await focusBlockAtIndex(page, 1);
    await page.keyboard.type("typed text");
    // Indent under the anchor — a distinct action that must form its own undo step.
    await page.keyboard.press("Tab");

    const parentAfterTab = await page.evaluate(() => {
      const block = window.blokInstance?.blocks.getBlockByIndex(1);
      return block?.parentId ?? null;
    });
    expect(parentAfterTab).not.toBeNull();

    // A single undo reverts ONLY the indent — the typed text must survive.
    const modifier = process.platform === "darwin" ? "Meta" : "Control";
    await page.keyboard.press(`${modifier}+z`);

    const state = await page.evaluate(async () => {
      if (!window.blokInstance) return null;
      const saved = await window.blokInstance.save();
      const block = window.blokInstance.blocks.getBlockByIndex(1);
      return { text: saved.blocks[1]?.data.text ?? "", parentId: block?.parentId ?? null };
    });

    expect(state?.parentId).toBeNull();
    expect(state?.text).toContain("typed text");
  });
});
