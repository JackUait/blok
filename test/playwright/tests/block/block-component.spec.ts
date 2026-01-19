import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { BLOK_INTERFACE_SELECTOR } from "../../../../src/components/constants";
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from "../helpers/ensure-build";

const HOLDER_ID = "blok-e2e-test";
const BLOCK_WRAPPER_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"]`;
const getBlockWrapperSelectorByIndex = (index: number): string => {
  return `:nth-match(${BLOCK_WRAPPER_SELECTOR}, ${index + 1})`;
};

type ToolDefinition = {
  name: string;
  classSource: string;
  config?: Record<string, unknown>;
};

type BlokSetupOptions = {
  data?: Record<string, unknown>;
  config?: Record<string, unknown>;
  tools?: ToolDefinition[];
  tunes?: string[];
};

const resetBlok = async (page: Page): Promise<void> => {
  await page.evaluate(
    async ({ holder }) => {
      // Clean up existing instance
      if (window.blokInstance) {
        await window.blokInstance.destroy?.();
        window.blokInstance = undefined;
      }

      // Remove existing holder if it exists (might already be removed by destroy)
      const existingHolder = document.getElementById(holder);
      if (existingHolder) {
        existingHolder.remove();
      }

      // Create fresh holder
      const container = document.createElement("div");

      container.id = holder;
      container.setAttribute("data-blok-testid", holder);
      container.style.border = "1px dotted #388AE5";

      document.body.appendChild(container);
    },
    { holder: HOLDER_ID },
  );
};

const createBlok = async (
  page: Page,
  options: BlokSetupOptions = {},
): Promise<void> => {
  const { data, config, tools = [], tunes } = options;

  await resetBlok(page);
  // Wait for holder to be fully created before creating Blok instance
  // eslint-disable-next-line playwright/no-wait-for-selector -- Need to ensure DOM is ready after reset
  await page.waitForSelector(`#${HOLDER_ID}`);
  await page.waitForFunction(() => typeof window.Blok === "function");

  await page.evaluate(
    async ({
      holder,
      rawData,
      rawConfig,
      serializedTools,
      tunes: tunesArray,
    }) => {
      const reviveToolClass = (classSource: string): unknown => {
        // eslint-disable-next-line no-new-func, @typescript-eslint/no-unsafe-call -- Required for dynamically creating tool classes in tests
        return new Function(`return (${classSource});`)();
      };

      const revivedTools = serializedTools.reduce<
        Record<string, Record<string, unknown>>
      >((accumulator, toolConfig) => {
        const revivedClass = reviveToolClass(toolConfig.classSource);

        const toolSettings: Record<string, unknown> = {
          class: revivedClass,
        };

        if (toolConfig.config !== undefined) {
          toolSettings.config = toolConfig.config;
        }

        return {
          ...accumulator,
          [toolConfig.name]: toolSettings,
        };
      }, {});

      const blokConfig: Record<string, unknown> = {
        holder: holder,
        ...rawConfig,
        ...(serializedTools.length > 0 ? { tools: revivedTools } : {}),
        ...(rawData ? { data: rawData } : {}),
      };

      if (tunesArray && tunesArray.length > 0) {
        blokConfig.tunes = tunesArray;
      }

      const blok = new window.Blok(blokConfig);

      window.blokInstance = blok;
      await blok.isReady;
    },
    {
      holder: HOLDER_ID,
      rawData: data ?? null,
      rawConfig: config ?? {},
      serializedTools: tools,
      tunes: tunes ?? [],
    },
  );
};

/**
 * E2E tests for the Block component.
 * Tests cover the refactored block sub-modules:
 * - ToolRenderer
 * - InputManager
 * - MutationHandler
 * - SelectionManager
 * - StyleManager
 * - TunesManager
 * - DataPersistenceManager
 */
test.describe("block component - refactored modules", () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
  });

  test.describe("toolRenderer - block rendering", () => {
    test("should render block with correct wrapper and content structure", async ({
      page,
    }) => {
      await createBlok(page, {
        data: {
          blocks: [
            {
              type: "paragraph",
              data: { text: "Test content" },
            },
          ],
        },
      });

      // Check wrapper exists with correct attributes
      const wrapper = page.locator(BLOCK_WRAPPER_SELECTOR);
      await expect(wrapper).toHaveCount(1);
      await expect(wrapper).toHaveAttribute("data-blok-element", "");
      await expect(wrapper).toHaveAttribute("data-blok-component", "paragraph");

      // Check content element exists
      const content = wrapper.locator("[data-blok-element-content]");
      await expect(content).toHaveCount(1);
      await expect(content).toHaveAttribute(
        "data-blok-testid",
        "block-content",
      );

      // Check plugins content has the text
      await expect(content).toHaveText("Test content");
    });

    test("should set block id in DOM", async ({ page }) => {
      const blockId = "custom-block-id";

      await createBlok(page, {
        data: {
          blocks: [
            {
              id: blockId,
              type: "paragraph",
              data: { text: "Content" },
            },
          ],
        },
      });

      const wrapper = page.locator(BLOCK_WRAPPER_SELECTOR);
      await expect(wrapper).toHaveAttribute("data-blok-id", blockId);
    });

    test("should call tool rendered lifecycle method", async ({ page }) => {
      // Create a tool that stores rendered state in a global variable we can check
      await page.evaluate(() => {
        (window as { renderedCalled?: boolean }).renderedCalled = false;
      });

      const TOOL_WITH_RENDERED = `class ToolWithRendered {
        constructor({ data, api }) {
          this.data = data;
          this.api = api;
          // Store reference to element for later use in rendered()
          this.element = null;
        }

        static get toolbox() {
          return { icon: 'T', title: 'Test Tool' };
        }

        render() {
          const element = document.createElement('div');
          element.contentEditable = 'true';
          element.innerHTML = this.data?.text || '';
          // Store element reference
          this.element = element;
          return element;
        }

        save(block) {
          return { text: block.innerHTML };
        }

        rendered() {
          // Mark that rendered was called via the block's holder dataset
          // This is called after the element is in the DOM
          this.api.blocks.update(this.api.blocks.getCurrentBlockIndex(), {});
          // Store rendered state globally for verification
          window.renderedCalled = true;
        }
      }`;

      await createBlok(page, {
        tools: [
          {
            name: "testTool",
            classSource: TOOL_WITH_RENDERED,
          },
        ],
        data: {
          blocks: [
            {
              type: "testTool",
              data: { text: "Test" },
            },
          ],
        },
      });

      // Wait for block to be ready (rendered lifecycle)
      await page.waitForFunction(
        () => (window as { renderedCalled?: boolean }).renderedCalled === true,
        undefined,
        { timeout: 2000 },
      );

      const result = await page.evaluate(() => {
        return {
          renderedCalled:
            (window as { renderedCalled?: boolean }).renderedCalled || false,
        };
      });

      expect(result.renderedCalled).toBe(true);
    });
  });

  test.describe("inputManager - input handling", () => {
    test("should detect contenteditable as block inputs", async ({ page }) => {
      await createBlok(page, {
        data: {
          blocks: [
            {
              type: "paragraph",
              data: { text: "Initial content" },
            },
          ],
        },
      });

      const content = page.locator(
        '[data-blok-element-content] div[contenteditable="true"]',
      );
      await expect(content).toHaveCount(1);
    });

    test("should update current input on focus", async ({ page }) => {
      await createBlok(page, {
        data: {
          blocks: [
            {
              type: "paragraph",
              data: { text: "First block" },
            },
            {
              type: "paragraph",
              data: { text: "Second block" },
            },
          ],
        },
      });

      // Click in the first block
      const firstBlock = page.locator(getBlockWrapperSelectorByIndex(0));
      await firstBlock.click();

      // Type in the first block
      await firstBlock.locator('[contenteditable="true"]').type(" more text");

      await expect(firstBlock).toContainText("First block more text");
    });

    test("should handle multiple input elements in a block", async ({
      page,
    }) => {
      const MULTI_INPUT_TOOL = `class MultiInputTool {
        constructor({ data }) {
          this.data = data;
        }

        static get toolbox() {
          return { icon: 'M', title: 'Multi Input' };
        }

        render() {
          const wrapper = document.createElement('div');

          const input1 = document.createElement('input');
          input1.type = 'text';
          input1.placeholder = 'Input 1';

          const input2 = document.createElement('input');
          input2.type = 'text';
          input2.placeholder = 'Input 2';

          wrapper.appendChild(input1);
          wrapper.appendChild(input2);

          return wrapper;
        }

        save(block) {
          const inputs = block.querySelectorAll('input');
          return {
            input1: inputs[0].value,
            input2: inputs[1].value,
          };
        }
      }`;

      await createBlok(page, {
        tools: [
          {
            name: "multiInput",
            classSource: MULTI_INPUT_TOOL,
          },
        ],
        data: {
          blocks: [
            {
              type: "multiInput",
              data: {},
            },
          ],
        },
      });

      // Use getByPlaceholder for semantic element identification
      const firstInput = page.getByPlaceholder("Input 1");
      const secondInput = page.getByPlaceholder("Input 2");

      // Type in both inputs
      await firstInput.fill("First value");
      await secondInput.fill("Second value");

      await expect(firstInput).toHaveValue("First value");
      await expect(secondInput).toHaveValue("Second value");
    });
  });

  test.describe("mutationHandler - DOM changes", () => {
    test("should detect DOM mutations and trigger update", async ({ page }) => {
      await createBlok(page, {
        data: {
          blocks: [
            {
              type: "paragraph",
              data: { text: "Initial" },
            },
          ],
        },
      });

      const block = page.locator(getBlockWrapperSelectorByIndex(0));
      const contentEditable = block.locator('[contenteditable="true"]');

      // Click and type to trigger mutation
      await contentEditable.click();
      await contentEditable.type(" text");

      // Verify content changed
      await expect(contentEditable).toHaveText("Initial text");
    });

    test("should detect mutations from programmatic DOM changes", async ({
      page,
    }) => {
      await createBlok(page, {
        data: {
          blocks: [
            {
              type: "paragraph",
              data: { text: "Original" },
            },
          ],
        },
      });

      // Programmatically change the DOM
      await page.evaluate(() => {
        if (!window.blokInstance) {
          throw new Error("Blok instance not found");
        }
        const block = window.blokInstance.blocks.getBlockByIndex(0);
        if (!block) {
          throw new Error("Block not found");
        }

        const content = block.holder.querySelector('[contenteditable="true"]');
        if (content) {
          content.innerHTML = "Changed programmatically";
        }
      });

      const block = page.locator(getBlockWrapperSelectorByIndex(0));
      await expect(block).toContainText("Changed programmatically");
    });

    test("should handle tool replacing its element", async ({ page }) => {
      const SELF_REPLACING_TOOL = `class SelfReplacingTool {
        constructor({ data, api }) {
          this.data = data;
          this.api = api;
        }

        static get toolbox() {
          return { icon: 'R', title: 'Self Replacing' };
        }

        render() {
          const element = document.createElement('div');
          element.contentEditable = 'true';
          element.innerHTML = this.data?.text || '';

          // After render, replace the element
          setTimeout(() => {
            const newElement = document.createElement('div');
            newElement.contentEditable = 'true';
            newElement.innerHTML = 'Replaced content';

            const wrapper = element.parentElement;
            if (wrapper) {
              wrapper.replaceChild(newElement, element);
              // Trigger mutation
              this.api.blocks.update(this.api.blocks.getCurrentBlockIndex(), { text: 'Replaced content' });
            }
          }, 10);

          return element;
        }

        save(block) {
          return { text: block.innerHTML };
        }
      }`;

      await createBlok(page, {
        tools: [
          {
            name: "selfReplacing",
            classSource: SELF_REPLACING_TOOL,
          },
        ],
        data: {
          blocks: [
            {
              type: "selfReplacing",
              data: { text: "Initial" },
            },
          ],
        },
      });

      // Wait for the replacement to happen
      // eslint-disable-next-line playwright/no-wait-for-timeout -- Waiting for setTimeout in tool to complete
      await page.waitForTimeout(10);

      const block = page.locator(getBlockWrapperSelectorByIndex(0));
      // The block should still exist and have content
      await expect(block).toBeVisible();
    });
  });

  test.describe("selectionManager - block focus and current block", () => {
    test("should get current block index", async ({ page }) => {
      await createBlok(page, {
        data: {
          blocks: [
            {
              type: "paragraph",
              data: { text: "First block" },
            },
            {
              type: "paragraph",
              data: { text: "Second block" },
            },
          ],
        },
      });

      // Click on first block to make it current
      const firstBlock = page.locator(getBlockWrapperSelectorByIndex(0));
      await firstBlock.click();

      // Current block should be 0 after clicking
      const currentIndex = await page.evaluate(() => {
        if (!window.blokInstance) {
          throw new Error("Blok instance not found");
        }
        return window.blokInstance.blocks.getCurrentBlockIndex();
      });

      expect(currentIndex).toBe(0);
    });

    test("should update current block when clicking a different block", async ({
      page,
    }) => {
      await createBlok(page, {
        data: {
          blocks: [
            {
              type: "paragraph",
              data: { text: "First block" },
            },
            {
              type: "paragraph",
              data: { text: "Second block" },
            },
          ],
        },
      });

      // Click on second block
      const secondBlock = page.locator(getBlockWrapperSelectorByIndex(1));
      await secondBlock.click();

      // Current block index should now be 1
      const currentIndex = await page.evaluate(() => {
        if (!window.blokInstance) {
          throw new Error("Blok instance not found");
        }
        return window.blokInstance.blocks.getCurrentBlockIndex();
      });

      expect(currentIndex).toBe(1);
    });

    test("should get block by element", async ({ page }) => {
      await createBlok(page, {
        data: {
          blocks: [
            {
              type: "paragraph",
              data: { text: "Test block" },
            },
          ],
        },
      });

      const result = await page.evaluate(() => {
        if (!window.blokInstance) {
          throw new Error("Blok instance not found");
        }
        const wrapper = document.querySelector(
          '[data-blok-testid="block-wrapper"]',
        );
        if (!wrapper) {
          return { found: false };
        }
        const block = window.blokInstance.blocks.getBlockByElement(
          wrapper as HTMLElement,
        );
        return {
          found: block !== undefined,
          hasId: block?.id !== undefined,
        };
      });

      expect(result.found).toBe(true);
      expect(result.hasId).toBe(true);
    });
  });

  test.describe("styleManager - stretched state", () => {
    test("should apply stretched class when block is stretched", async ({
      page,
    }) => {
      await createBlok(page, {
        data: {
          blocks: [
            {
              type: "paragraph",
              data: { text: "Normal block" },
            },
          ],
        },
      });

      // Get the initial block and stretch it
      const result = await page.evaluate(() => {
        if (!window.blokInstance) {
          throw new Error("Blok instance not found");
        }
        const block = window.blokInstance.blocks.getBlockByIndex(0);
        if (!block) {
          throw new Error("Block not found");
        }

        block.stretched = true;

        return {
          hasStretchedAttr: block.holder.hasAttribute("data-blok-stretched"),
        };
      });

      expect(result.hasStretchedAttr).toBe(true);
    });

    test("should remove stretched class when unstretched", async ({ page }) => {
      await createBlok(page, {
        data: {
          blocks: [
            {
              type: "paragraph",
              data: { text: "Block to stretch" },
            },
          ],
        },
      });

      // Stretch then unstretch
      const result = await page.evaluate(() => {
        if (!window.blokInstance) {
          throw new Error("Blok instance not found");
        }
        const block = window.blokInstance.blocks.getBlockByIndex(0);
        if (!block) {
          throw new Error("Block not found");
        }

        block.stretched = true;
        const wasStretched = block.holder.hasAttribute("data-blok-stretched");

        block.stretched = false;
        const isStillStretched = block.holder.hasAttribute(
          "data-blok-stretched",
        );

        return { wasStretched, isStillStretched };
      });

      expect(result.wasStretched).toBe(true);
      expect(result.isStillStretched).toBe(false);
    });
  });

  test.describe("dataPersistenceManager - save and data", () => {
    test("should save block data correctly", async ({ page }) => {
      await createBlok(page, {
        data: {
          blocks: [
            {
              type: "paragraph",
              data: { text: "Test content" },
            },
          ],
        },
      });

      const savedData = await page.evaluate(async () => {
        if (!window.blokInstance) {
          throw new Error("Blok instance not found");
        }
        return await window.blokInstance.save();
      });

      expect(savedData.blocks).toHaveLength(1);
      expect(savedData.blocks[0].type).toBe("paragraph");
      expect((savedData.blocks[0].data as { text: string }).text).toBe(
        "Test content",
      );
    });

    test("should update block data via blocks.update", async ({ page }) => {
      await createBlok(page, {
        data: {
          blocks: [
            {
              id: "update-test-block",
              type: "paragraph",
              data: { text: "Initial text" },
            },
          ],
        },
      });

      await page.evaluate(async () => {
        if (!window.blokInstance) {
          throw new Error("Blok instance not found");
        }
        await window.blokInstance.blocks.update("update-test-block", {
          text: "Updated text",
        });
      });

      const block = page.locator(getBlockWrapperSelectorByIndex(0));
      await expect(block).toContainText("Updated text");

      const savedData = await page.evaluate(async () => {
        if (!window.blokInstance) {
          throw new Error("Blok instance not found");
        }
        return await window.blokInstance.save();
      });

      expect((savedData.blocks[0].data as { text: string }).text).toBe(
        "Updated text",
      );
    });

    test("should validate block data", async ({ page }) => {
      const VALIDATING_TOOL = `class ValidatingTool {
        constructor({ data }) {
          this.data = data;
        }

        static get toolbox() {
          return { icon: 'V', title: 'Validating Tool' };
        }

        render() {
          const element = document.createElement('div');
          element.contentEditable = 'true';
          element.innerHTML = this.data?.text || '';
          return element;
        }

        save(block) {
          return { text: block.innerHTML };
        }

        validate(savedData) {
          // Data is valid if text is not empty
          return savedData.text && savedData.text.trim().length > 0;
        }
      }`;

      await createBlok(page, {
        tools: [
          {
            name: "validating",
            classSource: VALIDATING_TOOL,
          },
        ],
        data: {
          blocks: [
            {
              type: "validating",
              data: { text: "Valid content" },
            },
          ],
        },
      });

      const isValid = await page.evaluate(async () => {
        if (!window.blokInstance) {
          throw new Error("Blok instance not found");
        }
        const block = window.blokInstance.blocks.getBlockByIndex(0);
        if (!block) {
          return false;
        }
        return await block.validate({ text: "Valid content" });
      });

      expect(isValid).toBe(true);
    });
  });

  test.describe("tunesManager - block tunes", () => {
    test("should extract and save tune data", async ({ page }) => {
      const TUNE_TOOL = `class TuneTool {
        constructor({ data }) {
          this.data = data;
        }

        static get toolbox() {
          return { icon: 'T', title: 'Tool with Tune' };
        }

        render() {
          const element = document.createElement('div');
          element.contentEditable = 'true';
          element.innerHTML = this.data?.text || '';
          return element;
        }

        save(block) {
          return { text: block.innerHTML };
        }
      }`;

      await createBlok(page, {
        tools: [
          {
            name: "tuneTool",
            classSource: TUNE_TOOL,
          },
        ],
        tunes: ["testTune"],
        data: {
          blocks: [
            {
              type: "tuneTool",
              data: { text: "Content" },
              tunes: {
                testTune: { enabled: true, customField: "value" },
              },
            },
          ],
        },
      });

      // Save and check that tune data is preserved
      const savedData = await page.evaluate(async () => {
        if (!window.blokInstance) {
          throw new Error("Blok instance not found");
        }
        return await window.blokInstance.save();
      });

      expect(savedData.blocks).toHaveLength(1);
      expect(savedData.blocks[0].tunes).toStrictEqual({
        testTune: { enabled: true, customField: "value" },
      });
    });

    test("should initialize tune with provided data", async ({ page }) => {
      const TUNE_TOOL = `class TuneTool {
        constructor({ data }) {
          this.data = data;
        }

        static get toolbox() {
          return { icon: 'T', title: 'Tool with Tune' };
        }

        render() {
          const element = document.createElement('div');
          element.contentEditable = 'true';
          element.innerHTML = this.data?.text || '';
          return element;
        }

        save(block) {
          return { text: block.innerHTML };
        }
      }`;

      await createBlok(page, {
        tools: [
          {
            name: "tuneTool",
            classSource: TUNE_TOOL,
          },
        ],
        tunes: ["statefulTune"],
        data: {
          blocks: [
            {
              type: "tuneTool",
              data: { text: "Content" },
              tunes: {
                statefulTune: { state: "active", count: 5 },
              },
            },
          ],
        },
      });

      // Verify tune data is preserved in save output
      const savedData = await page.evaluate(async () => {
        if (!window.blokInstance) {
          throw new Error("Blok instance not found");
        }
        return await window.blokInstance.save();
      });

      expect(savedData.blocks).toHaveLength(1);
      expect(savedData.blocks[0].tunes).toStrictEqual({
        statefulTune: { state: "active", count: 5 },
      });
    });
  });

  test.describe("block lifecycle - creation and deletion", () => {
    test("should create new block when pressing Enter in empty block", async ({
      page,
    }) => {
      await createBlok(page, {
        data: {
          blocks: [
            {
              type: "paragraph",
              data: { text: "" },
            },
          ],
        },
      });

      const initialBlockCount = await page.evaluate(() => {
        if (!window.blokInstance) {
          throw new Error("Blok instance not found");
        }
        const blocks = window.blokInstance.blocks.getBlocksCount();
        return blocks;
      });

      expect(initialBlockCount).toBe(1);

      // Press Enter in the empty block
      const block = page.locator(getBlockWrapperSelectorByIndex(0));
      await block.click();
      await page.keyboard.press("Enter");

      // Should create a new block
      const newBlockCount = await page.evaluate(() => {
        if (!window.blokInstance) {
          throw new Error("Blok instance not found");
        }
        return window.blokInstance.blocks.getBlocksCount();
      });

      expect(newBlockCount).toBe(2);
    });

    test("should delete block when Backspace is pressed in empty block", async ({
      page,
    }) => {
      await createBlok(page, {
        data: {
          blocks: [
            {
              type: "paragraph",
              data: { text: "First block" },
            },
            {
              type: "paragraph",
              data: { text: "" },
            },
          ],
        },
      });

      // Click in the empty second block and press Backspace
      const secondBlock = page.locator(getBlockWrapperSelectorByIndex(1));
      await secondBlock.click();
      await page.keyboard.press("Backspace");

      // Should delete the empty block and merge/keep first block
      const finalBlockCount = await page.evaluate(() => {
        if (!window.blokInstance) {
          throw new Error("Blok instance not found");
        }
        return window.blokInstance.blocks.getBlocksCount();
      });

      expect(finalBlockCount).toBe(1);
    });
  });

  test.describe("block focusable state", () => {
    test("should report focusable state correctly", async ({ page }) => {
      await createBlok(page, {
        data: {
          blocks: [
            {
              type: "paragraph",
              data: { text: "Focusable block" },
            },
          ],
        },
      });

      const result = await page.evaluate(() => {
        if (!window.blokInstance) {
          throw new Error("Blok instance not found");
        }
        const block = window.blokInstance.blocks.getBlockByIndex(0);
        if (!block) {
          return { focusable: false };
        }
        return { focusable: block.focusable };
      });

      // Paragraph blocks are focusable (have contenteditable)
      expect(result.focusable).toBe(true);
    });
  });

  test.describe("block empty state detection", () => {
    test("should detect empty block", async ({ page }) => {
      await createBlok(page, {
        data: {
          blocks: [
            {
              type: "paragraph",
              data: { text: "" },
            },
          ],
        },
      });

      const result = await page.evaluate(() => {
        if (!window.blokInstance) {
          throw new Error("Blok instance not found");
        }
        const block = window.blokInstance.blocks.getBlockByIndex(0);
        if (!block) {
          return { isEmpty: false };
        }
        return { isEmpty: block.isEmpty };
      });

      expect(result.isEmpty).toBe(true);
    });

    test("should detect non-empty block", async ({ page }) => {
      await createBlok(page, {
        data: {
          blocks: [
            {
              type: "paragraph",
              data: { text: "Content here" },
            },
          ],
        },
      });

      const result = await page.evaluate(() => {
        if (!window.blokInstance) {
          throw new Error("Blok instance not found");
        }
        const block = window.blokInstance.blocks.getBlockByIndex(0);
        if (!block) {
          return { isEmpty: false };
        }
        return { isEmpty: block.isEmpty };
      });

      expect(result.isEmpty).toBe(false);
    });
  });

  test.describe("block content element access", () => {
    test("should provide access to plugins content", async ({ page }) => {
      await createBlok(page, {
        data: {
          blocks: [
            {
              type: "paragraph",
              data: { text: "Plugin content" },
            },
          ],
        },
      });

      const content = await page.evaluate(() => {
        if (!window.blokInstance) {
          throw new Error("Blok instance not found");
        }
        const block = window.blokInstance.blocks.getBlockByIndex(0);
        if (!block) {
          return "";
        }

        const pluginsContent = block.holder.querySelector(
          "[data-blok-element-content] div",
        );
        return pluginsContent?.innerHTML || "";
      });

      expect(content).toBe("Plugin content");
    });
  });
});
