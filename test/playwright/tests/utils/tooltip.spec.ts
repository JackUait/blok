import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';
import { TOOLTIP_INTERFACE_SELECTOR } from '../../../../src/components/constants';

const HOLDER_ID = 'blok';

/**
 * Reset the blok holder and destroy any existing instance
 * @param page - The Playwright page object
 */
const resetBlok = async (page: Page): Promise<void> => {
  await page.evaluate(async ({ holder }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }

    document.getElementById(holder)?.remove();

    const container = document.createElement('div');

    container.id = holder;
    container.setAttribute('data-blok-testid', holder);
    container.style.border = '1px dotted #388AE5';

    document.body.appendChild(container);
  }, { holder: HOLDER_ID });
};

/**
 * Create blok instance
 * @param page - The Playwright page object
 */
const createBlok = async (page: Page): Promise<void> => {
  await page.waitForFunction(() => typeof window.Blok === 'function');

  await page.evaluate(async ({ holder }) => {
    const blok = new window.Blok({
      holder: holder,
    });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID });
};

/**
 * Wait for tooltip to appear and verify it's visible
 * @param page - The Playwright page object
 * @returns The tooltip locator
 */
const waitForTooltip = async (page: Page): Promise<Locator> => {
  const tooltip = page.locator(TOOLTIP_INTERFACE_SELECTOR);

  await expect(tooltip).toBeVisible();

  return tooltip;
};

/**
 * Wait for tooltip to disappear
 * @param page - The Playwright page object
 */
const waitForTooltipToHide = async (page: Page): Promise<void> => {
  const tooltip = page.locator(TOOLTIP_INTERFACE_SELECTOR);

  await expect(tooltip).toBeHidden();
};

test.describe('tooltip API', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await resetBlok(page);
    await createBlok(page);
  });

  test.describe('show()', () => {
    test('should show tooltip with text content', async ({ page }) => {
      const testElement = await page.evaluate(({ holder }) => {
        const container = document.getElementById(holder);
        const element = document.createElement('button');

        element.textContent = 'Test Button';
        element.id = 'test-button';
        container?.appendChild(element);

        return {
          id: element.id,
        };
      }, { holder: HOLDER_ID });

      await page.evaluate(({ elementId }) => {
        const blok = window.blokInstance;
        const element = document.getElementById(elementId);

        if (element && blok?.tooltip) {
          blok.tooltip.show(element, 'Test tooltip text');
        }
      }, { elementId: testElement.id });

      const tooltip = await waitForTooltip(page);

      await expect(tooltip).toContainText('Test tooltip text');
    });

    test('should show tooltip with HTML content', async ({ page }) => {
      const testElement = await page.evaluate(({ holder }) => {
        const container = document.getElementById(holder);
        const element = document.createElement('div');

        element.textContent = 'Hover me';
        element.id = 'test-element';
        container?.appendChild(element);

        return {
          id: element.id,
        };
      }, { holder: HOLDER_ID });

      await page.evaluate(({ elementId }) => {
        const blok = window.blokInstance;
        const element = document.getElementById(elementId);

        if (element && blok?.tooltip) {
          const htmlContent = document.createElement('div');

          htmlContent.innerHTML = '<strong>Bold</strong> tooltip';
          blok.tooltip.show(element, htmlContent);
        }
      }, { elementId: testElement.id });

      const tooltip = await waitForTooltip(page);

      await expect(tooltip.getByRole('strong')).toContainText('Bold');
      await expect(tooltip).toContainText('tooltip');
    });

    test('should show tooltip with options', async ({ page }) => {
      const testElement = await page.evaluate(({ holder }) => {
        const container = document.getElementById(holder);
        const element = document.createElement('span');

        element.textContent = 'Test';
        element.id = 'test-span';
        container?.appendChild(element);

        return {
          id: element.id,
        };
      }, { holder: HOLDER_ID });

      await page.evaluate(({ elementId }) => {
        const blok = window.blokInstance;
        const element = document.getElementById(elementId);

        if (element && blok?.tooltip) {
          blok.tooltip.show(element, 'Tooltip with options', {
            placement: 'top',
          });
        }
      }, { elementId: testElement.id });

      const tooltip = await waitForTooltip(page);

      await expect(tooltip).toBeVisible();
      await expect(tooltip).toContainText('Tooltip with options');
    });

    test('should replace existing tooltip when showing new one', async ({ page }) => {
      const testElements = await page.evaluate(({ holder }) => {
        const container = document.getElementById(holder);
        const element1 = document.createElement('button');

        element1.textContent = 'Button 1';
        element1.id = 'button-1';
        const element2 = document.createElement('button');

        element2.textContent = 'Button 2';
        element2.id = 'button-2';
        container?.appendChild(element1);
        container?.appendChild(element2);

        return {
          id1: element1.id,
          id2: element2.id,
        };
      }, { holder: HOLDER_ID });

      // Show first tooltip
      await page.evaluate(({ elementId }) => {
        const blok = window.blokInstance;
        const element = document.getElementById(elementId);

        if (element && blok?.tooltip) {
          blok.tooltip.show(element, 'First tooltip');
        }
      }, { elementId: testElements.id1 });

      let tooltip = await waitForTooltip(page);

      await expect(tooltip).toContainText('First tooltip');

      // Show second tooltip - should replace the first
      await page.evaluate(({ elementId }) => {
        const blok = window.blokInstance;
        const element = document.getElementById(elementId);

        if (element && blok?.tooltip) {
          blok.tooltip.show(element, 'Second tooltip');
        }
      }, { elementId: testElements.id2 });

      tooltip = await waitForTooltip(page);
      await expect(tooltip).toContainText('Second tooltip');
      await expect(tooltip).not.toContainText('First tooltip');
    });

    test('should throw when content is neither string nor Node', async ({ page }) => {
      const testElement = await page.evaluate(({ holder }) => {
        const container = document.getElementById(holder);
        const element = document.createElement('div');

        element.textContent = 'Invalid content test';
        element.id = 'invalid-content';
        container?.appendChild(element);

        return {
          id: element.id,
        };
      }, { holder: HOLDER_ID });

      const errorMessage = await page.evaluate(({ elementId }) => {
        const blok = window.blokInstance;
        const element = document.getElementById(elementId);

        if (!element || !blok?.tooltip) {
          return null;
        }

        try {
          const invalidContent = { text: 'invalid' } as unknown as Node;

          blok.tooltip.show(element, invalidContent);

          return 'no error';
        } catch (error) {
          if (error instanceof Error) {
            return error.message;
          }

          return String(error);
        }
      }, { elementId: testElement.id });

      expect(errorMessage).not.toBeNull();
      expect(errorMessage).not.toBe('no error');
      expect(errorMessage).toContain('[Blok Tooltip] Wrong type');
    });
  });

  test.describe('hide()', () => {
    test('should hide visible tooltip', async ({ page }) => {
      const testElement = await page.evaluate(({ holder }) => {
        const container = document.getElementById(holder);
        const element = document.createElement('button');

        element.textContent = 'Test Button';
        element.id = 'test-button';
        container?.appendChild(element);

        return {
          id: element.id,
        };
      }, { holder: HOLDER_ID });

      // Show tooltip
      await page.evaluate(({ elementId }) => {
        const blok = window.blokInstance;
        const element = document.getElementById(elementId);

        if (element && blok?.tooltip) {
          blok.tooltip.show(element, 'Test tooltip');
        }
      }, { elementId: testElement.id });

      const tooltip = await waitForTooltip(page);

      await expect(tooltip).toContainText('Test tooltip');

      // Hide tooltip
      await page.evaluate(() => {
        const blok = window.blokInstance;

        if (blok?.tooltip) {
          blok.tooltip.hide();
        }
      });

      await waitForTooltipToHide(page);
    });

    test('should hide tooltip when hide() is called', async ({ page }) => {
      const testElement = await page.evaluate(({ holder }) => {
        const container = document.getElementById(holder);
        const element = document.createElement('div');

        element.textContent = 'Test';
        element.id = 'test-element';
        container?.appendChild(element);

        return {
          id: element.id,
        };
      }, { holder: HOLDER_ID });

      await page.evaluate(({ elementId }) => {
        const blok = window.blokInstance;
        const element = document.getElementById(elementId);

        if (element && blok?.tooltip) {
          blok.tooltip.show(element, 'Tooltip with delay');
        }
      }, { elementId: testElement.id });

      const tooltipBeforeHide = await waitForTooltip(page);

      await expect(tooltipBeforeHide).toBeVisible();

      // Hide tooltip
      await page.evaluate(() => {
        const blok = window.blokInstance;

        if (blok?.tooltip) {
          blok.tooltip.hide();
        }
      });

      // Should hide
      await waitForTooltipToHide(page);
    });


    test('should handle hide() when no tooltip is visible', async ({ page }) => {
      // Calling hide() when no tooltip is visible should not throw
      await page.evaluate(() => {
        const blok = window.blokInstance;

        if (blok?.tooltip) {
          blok.tooltip.hide();
        }
      });

      // Verify no tooltip appears
      const tooltip = page.locator(TOOLTIP_INTERFACE_SELECTOR);

      await expect(tooltip).toBeHidden();
    });
  });

  test.describe('onHover()', () => {
    test('should show tooltip on mouseenter', async ({ page }) => {
      const testElement = await page.evaluate(({ holder }) => {
        const container = document.getElementById(holder);
        const element = document.createElement('button');

        element.textContent = 'Hover me';
        element.id = 'hover-button';
        container?.appendChild(element);

        return {
          id: element.id,
        };
      }, { holder: HOLDER_ID });

      await page.evaluate(({ elementId }) => {
        const blok = window.blokInstance;
        const element = document.getElementById(elementId);

        if (element && blok?.tooltip) {
          blok.tooltip.onHover(element, 'Hover tooltip');
        }
      }, { elementId: testElement.id });

      const button = page.locator(`#${testElement.id}`);

      await button.hover();

      const tooltip = await waitForTooltip(page);

      await expect(tooltip).toContainText('Hover tooltip');
    });

    test('should hide tooltip on mouseleave', async ({ page }) => {
      const testElement = await page.evaluate(({ holder }) => {
        const container = document.getElementById(holder);
        const element = document.createElement('div');

        element.textContent = 'Hover area';
        element.id = 'hover-area';
        element.style.padding = '20px';
        container?.appendChild(element);

        return {
          id: element.id,
        };
      }, { holder: HOLDER_ID });

      await page.evaluate(({ elementId }) => {
        const blok = window.blokInstance;
        const element = document.getElementById(elementId);

        if (element && blok?.tooltip) {
          blok.tooltip.onHover(element, 'Hover tooltip');
        }
      }, { elementId: testElement.id });

      const hoverArea = page.locator(`#${testElement.id}`);

      await hoverArea.hover();

      const tooltip = await waitForTooltip(page);

      await expect(tooltip).toBeVisible();

      // Move mouse away
      await page.mouse.move(0, 0);

      await waitForTooltipToHide(page);
    });

    test('should show tooltip on hover with HTML content', async ({ page }) => {
      const testElement = await page.evaluate(({ holder }) => {
        const container = document.getElementById(holder);
        const element = document.createElement('span');

        element.textContent = 'Rich tooltip';
        element.id = 'rich-tooltip';
        container?.appendChild(element);

        return {
          id: element.id,
        };
      }, { holder: HOLDER_ID });

      await page.evaluate(({ elementId }) => {
        const blok = window.blokInstance;
        const element = document.getElementById(elementId);

        if (element && blok?.tooltip) {
          const htmlContent = document.createElement('div');

          htmlContent.innerHTML = '<em>Italic</em> content';
          blok.tooltip.onHover(element, htmlContent);
        }
      }, { elementId: testElement.id });

      const element = page.locator(`#${testElement.id}`);

      await element.hover();

      const tooltip = await waitForTooltip(page);

      await expect(tooltip.getByRole('emphasis')).toContainText('Italic');
      await expect(tooltip).toContainText('content');
    });

    test('should show tooltip on hover with options', async ({ page }) => {
      const testElement = await page.evaluate(({ holder }) => {
        const container = document.getElementById(holder);
        const element = document.createElement('button');

        element.textContent = 'Configured tooltip';
        element.id = 'configured-button';
        container?.appendChild(element);

        return {
          id: element.id,
        };
      }, { holder: HOLDER_ID });

      await page.evaluate(({ elementId }) => {
        const blok = window.blokInstance;
        const element = document.getElementById(elementId);

        if (element && blok?.tooltip) {
          blok.tooltip.onHover(element, 'Tooltip with config', {
            placement: 'bottom',
            delay: 200,
          });
        }
      }, { elementId: testElement.id });

      const button = page.locator(`#${testElement.id}`);

      await button.hover();

      // Wait for tooltip to appear (accounting for delay of 200ms + rendering time)
      const tooltip = page.locator(TOOLTIP_INTERFACE_SELECTOR);

      await expect(tooltip).toBeVisible({ timeout: 1000 });
      await expect(tooltip).toContainText('Tooltip with config');
    });
  });

  test.describe('integration', () => {
    test('should handle multiple show/hide cycles', async ({ page }) => {
      const testElement = await page.evaluate(({ holder }) => {
        const container = document.getElementById(holder);
        const element = document.createElement('button');

        element.textContent = 'Toggle';
        element.id = 'toggle-button';
        container?.appendChild(element);

        return {
          id: element.id,
        };
      }, { holder: HOLDER_ID });

      // First cycle
      await page.evaluate(({ elementId }) => {
        const blok = window.blokInstance;
        const element = document.getElementById(elementId);

        if (element && blok?.tooltip) {
          blok.tooltip.show(element, 'First');
        }
      }, { elementId: testElement.id });

      const firstTooltip = await waitForTooltip(page);

      await expect(firstTooltip).toContainText('First');

      await page.evaluate(() => {
        const blok = window.blokInstance;

        if (blok?.tooltip) {
          blok.tooltip.hide();
        }
      });

      await waitForTooltipToHide(page);

      // Second cycle
      await page.evaluate(({ elementId }) => {
        const blok = window.blokInstance;
        const element = document.getElementById(elementId);

        if (element && blok?.tooltip) {
          blok.tooltip.show(element, 'Second');
        }
      }, { elementId: testElement.id });

      const tooltip = await waitForTooltip(page);

      await expect(tooltip).toContainText('Second');
    });

    test('should work with different element types', async ({ page }) => {
      const testElements = await page.evaluate(({ holder }) => {
        const container = document.getElementById(holder);
        const button = document.createElement('button');

        button.textContent = 'Button';
        button.id = 'test-button';
        const div = document.createElement('div');

        div.textContent = 'Div';
        div.id = 'test-div';
        const span = document.createElement('span');

        span.textContent = 'Span';
        span.id = 'test-span';
        container?.appendChild(button);
        container?.appendChild(div);
        container?.appendChild(span);

        return {
          buttonId: button.id,
          divId: div.id,
          spanId: span.id,
        };
      }, { holder: HOLDER_ID });

      // Test with button
      await page.evaluate(({ elementId }) => {
        const blok = window.blokInstance;
        const element = document.getElementById(elementId);

        if (element && blok?.tooltip) {
          blok.tooltip.show(element, 'Button tooltip');
        }
      }, { elementId: testElements.buttonId });

      let tooltip = await waitForTooltip(page);

      await expect(tooltip).toContainText('Button tooltip');

      await page.evaluate(() => {
        const blok = window.blokInstance;

        if (blok?.tooltip) {
          blok.tooltip.hide();
        }
      });

      await waitForTooltipToHide(page);

      // Test with div
      await page.evaluate(({ elementId }) => {
        const blok = window.blokInstance;
        const element = document.getElementById(elementId);

        if (element && blok?.tooltip) {
          blok.tooltip.show(element, 'Div tooltip');
        }
      }, { elementId: testElements.divId });

      tooltip = await waitForTooltip(page);
      await expect(tooltip).toContainText('Div tooltip');

      await page.evaluate(() => {
        const blok = window.blokInstance;

        if (blok?.tooltip) {
          blok.tooltip.hide();
        }
      });

      await waitForTooltipToHide(page);

      // Test with span
      await page.evaluate(({ elementId }) => {
        const blok = window.blokInstance;
        const element = document.getElementById(elementId);

        if (element && blok?.tooltip) {
          blok.tooltip.show(element, 'Span tooltip');
        }
      }, { elementId: testElements.spanId });

      tooltip = await waitForTooltip(page);
      await expect(tooltip).toContainText('Span tooltip');
    });
  });

  test.describe('destroy()', () => {
    test('should destroy tooltip library and allow reinitialization', async ({ page }) => {
      const testElement = await page.evaluate(({ holder }) => {
        const container = document.getElementById(holder);
        const element = document.createElement('button');

        element.textContent = 'Test';
        element.id = 'test-button';
        container?.appendChild(element);

        return {
          id: element.id,
        };
      }, { holder: HOLDER_ID });

      // Show tooltip before destroy
      await page.evaluate(({ elementId }) => {
        const blok = window.blokInstance;
        const element = document.getElementById(elementId);

        if (element && blok?.tooltip) {
          blok.tooltip.show(element, 'Before destroy');
        }
      }, { elementId: testElement.id });

      await waitForTooltip(page);

      // Destroy blok (which calls tooltip.destroy())
      await page.evaluate(async () => {
        if (window.blokInstance) {
          await window.blokInstance.destroy();
          window.blokInstance = undefined;
        }
      });

      // Recreate blok
      await createBlok(page);

      // Recreate test element if the holder was cleared during destroy
      await page.evaluate(({ holder, elementId }) => {
        const container = document.getElementById(holder);
        let element = document.getElementById(elementId);

        if (!element && container) {
          element = document.createElement('button');
          element.textContent = 'Test';
          element.id = elementId;
          container.appendChild(element);
        }
      }, { holder: HOLDER_ID,
        elementId: testElement.id });

      // Tooltip should work after reinitialization
      await page.evaluate(({ elementId }) => {
        const blok = window.blokInstance;
        const element = document.getElementById(elementId);

        if (element && blok?.tooltip) {
          blok.tooltip.show(element, 'After recreate');
        }
      }, { elementId: testElement.id });

      const tooltip = await waitForTooltip(page);

      await expect(tooltip).toContainText('After recreate');
    });

    test('should recreate tooltip element across reinitializations', async ({ page }) => {
      const testElement = await page.evaluate(({ holder }) => {
        const container = document.getElementById(holder);
        const element = document.createElement('button');

        element.textContent = 'Reinit check';
        element.id = 'reinit-button';
        container?.appendChild(element);

        return {
          id: element.id,
        };
      }, { holder: HOLDER_ID });

      await page.evaluate(({ elementId }) => {
        const blok = window.blokInstance;
        const element = document.getElementById(elementId);

        if (element && blok?.tooltip) {
          blok.tooltip.show(element, 'Initial tooltip', {
            delay: 0,
          });
        }
      }, { elementId: testElement.id, tooltipSelector: TOOLTIP_INTERFACE_SELECTOR });

      await waitForTooltip(page);

      const initialTooltipCount = await page.evaluate((selector) => {
        return document.querySelectorAll(selector).length;
      }, TOOLTIP_INTERFACE_SELECTOR);

      expect(initialTooltipCount).toBe(1);

      await page.evaluate(async () => {
        if (window.blokInstance) {
          await window.blokInstance.destroy();
          window.blokInstance = undefined;
        }
      });

      const afterDestroyTooltipCount = await page.evaluate((selector) => {
        return document.querySelectorAll(selector).length;
      }, TOOLTIP_INTERFACE_SELECTOR);

      expect(afterDestroyTooltipCount).toBe(0);

      await createBlok(page);

      await page.evaluate(({ holder, elementId }) => {
        const container = document.getElementById(holder);
        let element = document.getElementById(elementId);

        if (!element && container) {
          element = document.createElement('button');
          element.textContent = 'Reinit check';
          element.id = elementId;
          container.appendChild(element);
        }
      }, { holder: HOLDER_ID,
        elementId: testElement.id });

      await page.evaluate(({ elementId }) => {
        const blok = window.blokInstance;
        const element = document.getElementById(elementId);

        if (element && blok?.tooltip) {
          blok.tooltip.show(element, 'Tooltip after reinit', {
            delay: 0,
          });
        }
      }, { elementId: testElement.id });

      await waitForTooltip(page);

      const afterReinitTooltipCount = await page.evaluate((selector) => {
        return document.querySelectorAll(selector).length;
      }, TOOLTIP_INTERFACE_SELECTOR);

      expect(afterReinitTooltipCount).toBe(1);
    });
  });

  test.describe('edge cases', () => {
    test('should handle calling onHover() multiple times on same element', async ({ page }) => {
      const testElement = await page.evaluate(({ holder }) => {
        const container = document.getElementById(holder);
        const element = document.createElement('button');

        element.textContent = 'Hover me';
        element.id = 'hover-button';
        container?.appendChild(element);

        return {
          id: element.id,
        };
      }, { holder: HOLDER_ID });

      // First onHover binding
      await page.evaluate(({ elementId }) => {
        const blok = window.blokInstance;
        const element = document.getElementById(elementId);

        if (element && blok?.tooltip) {
          blok.tooltip.onHover(element, 'First binding');
        }
      }, { elementId: testElement.id });

      // Second onHover binding (should replace first)
      await page.evaluate(({ elementId }) => {
        const blok = window.blokInstance;
        const element = document.getElementById(elementId);

        if (element && blok?.tooltip) {
          blok.tooltip.onHover(element, 'Second binding');
        }
      }, { elementId: testElement.id });

      const button = page.locator(`#${testElement.id}`);

      await button.hover();

      const tooltip = await waitForTooltip(page);

      // Should show the second binding
      await expect(tooltip).toContainText('Second binding');
      await expect(tooltip).not.toContainText('First binding');
    });

    test('should handle calling show() multiple times on same element', async ({ page }) => {
      const testElement = await page.evaluate(({ holder }) => {
        const container = document.getElementById(holder);
        const element = document.createElement('div');

        element.textContent = 'Test';
        element.id = 'test-element';
        container?.appendChild(element);

        return {
          id: element.id,
        };
      }, { holder: HOLDER_ID });

      // First show
      await page.evaluate(({ elementId }) => {
        const blok = window.blokInstance;
        const element = document.getElementById(elementId);

        if (element && blok?.tooltip) {
          blok.tooltip.show(element, 'First show');
        }
      }, { elementId: testElement.id });

      let tooltip = await waitForTooltip(page);

      await expect(tooltip).toContainText('First show');

      // Second show on same element
      await page.evaluate(({ elementId }) => {
        const blok = window.blokInstance;
        const element = document.getElementById(elementId);

        if (element && blok?.tooltip) {
          blok.tooltip.show(element, 'Second show');
        }
      }, { elementId: testElement.id });

      tooltip = await waitForTooltip(page);

      // Should replace with second show
      await expect(tooltip).toContainText('Second show');
      await expect(tooltip).not.toContainText('First show');
    });

    test('should handle empty string content', async ({ page }) => {
      const testElement = await page.evaluate(({ holder }) => {
        const container = document.getElementById(holder);
        const element = document.createElement('button');

        element.textContent = 'Test';
        element.id = 'test-button';
        container?.appendChild(element);

        return {
          id: element.id,
        };
      }, { holder: HOLDER_ID });

      await page.evaluate(({ elementId }) => {
        const blok = window.blokInstance;
        const element = document.getElementById(elementId);

        if (element && blok?.tooltip) {
          blok.tooltip.show(element, '');
        }
      }, { elementId: testElement.id });

      // Tooltip should still appear (even if empty)
      const tooltip = page.locator(TOOLTIP_INTERFACE_SELECTOR);

      await expect(tooltip).toBeVisible();
    });

    test('should handle very long content', async ({ page }) => {
      const longText = 'A'.repeat(500);
      const testElement = await page.evaluate(({ holder }) => {
        const container = document.getElementById(holder);
        const element = document.createElement('div');

        element.textContent = 'Test';
        element.id = 'test-element';
        container?.appendChild(element);

        return {
          id: element.id,
        };
      }, { holder: HOLDER_ID });

      await page.evaluate(({ elementId, text }) => {
        const blok = window.blokInstance;
        const element = document.getElementById(elementId);

        if (element && blok?.tooltip) {
          blok.tooltip.show(element, text);
        }
      }, { elementId: testElement.id,
        text: longText });

      const tooltip = await waitForTooltip(page);

      await expect(tooltip).toContainText(longText.substring(0, 100));
    });

    test('should handle special characters in content', async ({ page }) => {
      const specialChars = '<>&"\'`';
      const testElement = await page.evaluate(({ holder }) => {
        const container = document.getElementById(holder);
        const element = document.createElement('span');

        element.textContent = 'Test';
        element.id = 'test-element';
        container?.appendChild(element);

        return {
          id: element.id,
        };
      }, { holder: HOLDER_ID });

      await page.evaluate(({ elementId, text }) => {
        const blok = window.blokInstance;
        const element = document.getElementById(elementId);

        if (element && blok?.tooltip) {
          blok.tooltip.show(element, text);
        }
      }, { elementId: testElement.id,
        text: specialChars });

      const tooltip = await waitForTooltip(page);

      await expect(tooltip).toBeVisible();
    });

    test('should handle interaction between show() and onHover()', async ({ page }) => {
      const testElement = await page.evaluate(({ holder }) => {
        const container = document.getElementById(holder);
        const element = document.createElement('button');

        element.textContent = 'Test';
        element.id = 'test-button';
        container?.appendChild(element);

        return {
          id: element.id,
        };
      }, { holder: HOLDER_ID });

      // First bind onHover
      await page.evaluate(({ elementId }) => {
        const blok = window.blokInstance;
        const element = document.getElementById(elementId);

        if (element && blok?.tooltip) {
          blok.tooltip.onHover(element, 'Hover tooltip');
        }
      }, { elementId: testElement.id });

      // Then show programmatically
      await page.evaluate(({ elementId }) => {
        const blok = window.blokInstance;
        const element = document.getElementById(elementId);

        if (element && blok?.tooltip) {
          blok.tooltip.show(element, 'Programmatic tooltip');
        }
      }, { elementId: testElement.id });

      const tooltip = await waitForTooltip(page);

      // Should show programmatic tooltip
      await expect(tooltip).toContainText('Programmatic tooltip');

      // Hide it
      await page.evaluate(() => {
        const blok = window.blokInstance;

        if (blok?.tooltip) {
          blok.tooltip.hide();
        }
      });

      await waitForTooltipToHide(page);

      // Hover should still work
      const button = page.locator(`#${testElement.id}`);

      await button.hover();

      const hoverTooltip = await waitForTooltip(page);

      await expect(hoverTooltip).toContainText('Hover tooltip');
    });

    test('should handle hide() called multiple times', async ({ page }) => {
      const testElement = await page.evaluate(({ holder }) => {
        const container = document.getElementById(holder);
        const element = document.createElement('div');

        element.textContent = 'Test';
        element.id = 'test-element';
        container?.appendChild(element);

        return {
          id: element.id,
        };
      }, { holder: HOLDER_ID });

      // Show tooltip
      await page.evaluate(({ elementId }) => {
        const blok = window.blokInstance;
        const element = document.getElementById(elementId);

        if (element && blok?.tooltip) {
          blok.tooltip.show(element, 'Test');
        }
      }, { elementId: testElement.id });

      const tooltip = await waitForTooltip(page);

      await expect(tooltip).toBeVisible();

      // Call hide() multiple times
      await page.evaluate(() => {
        const blok = window.blokInstance;

        if (blok?.tooltip) {
          blok.tooltip.hide();
          blok.tooltip.hide();
          blok.tooltip.hide();
        }
      });

      // Should still be hidden (no errors)
      await waitForTooltipToHide(page);
    });

    test('should hide tooltip when window scrolls', async ({ page }) => {
      const testElement = await page.evaluate(({ holder }) => {
        const container = document.getElementById(holder);
        const element = document.createElement('button');

        element.textContent = 'Scroll target';
        element.id = 'scroll-target';
        element.style.marginTop = '800px';
        container?.appendChild(element);

        return {
          id: element.id,
        };
      }, { holder: HOLDER_ID });

      await page.evaluate(() => {
        document.body.style.height = '2000px';
      });

      await page.evaluate(({ elementId }) => {
        const blok = window.blokInstance;
        const element = document.getElementById(elementId);

        if (element && blok?.tooltip) {
          blok.tooltip.show(element, 'Scroll tooltip', {
            delay: 0,
          });
        }
      }, { elementId: testElement.id });

      const tooltipBeforeScroll = await waitForTooltip(page);

      await expect(tooltipBeforeScroll).toBeVisible();

      await page.evaluate(() => {
        window.scrollTo(0, 100);
        window.dispatchEvent(new Event('scroll'));
      });

      await waitForTooltipToHide(page);

      await page.evaluate(() => {
        document.body.style.height = '';
        window.scrollTo(0, 0);
      });
    });

    test('should sync aria-hidden and visibility with tooltip state', async ({ page }) => {
      const testElement = await page.evaluate(({ holder }) => {
        const container = document.getElementById(holder);
        const element = document.createElement('button');

        element.textContent = 'Accessibility target';
        element.id = 'accessibility-target';
        container?.appendChild(element);

        return {
          id: element.id,
        };
      }, { holder: HOLDER_ID });

      await page.evaluate(({ elementId }) => {
        const blok = window.blokInstance;
        const element = document.getElementById(elementId);

        if (element && blok?.tooltip) {
          blok.tooltip.show(element, 'Accessible tooltip', {
            delay: 0,
          });
        }
      }, { elementId: testElement.id });

      const tooltip = await waitForTooltip(page);

      await expect(tooltip).toHaveAttribute('role', 'tooltip');
      await expect(tooltip).toHaveAttribute('aria-hidden', 'false');

      const shownState = await page.evaluate((selector) => {
        const tooltipElement = document.querySelector(selector);

        if (!tooltipElement) {
          return null;
        }

        return {
          ariaHidden: tooltipElement.getAttribute('aria-hidden'),
          visibility: (tooltipElement as HTMLElement).style.visibility,
        };
      }, TOOLTIP_INTERFACE_SELECTOR);

      expect(shownState).not.toBeNull();
      expect(shownState?.ariaHidden).toBe('false');
      expect(shownState?.visibility).toBe('visible');

      await page.evaluate(() => {
        const blok = window.blokInstance;

        if (blok?.tooltip) {
          blok.tooltip.hide();
        }
      });

      await waitForTooltipToHide(page);

      const hiddenState = await page.evaluate((selector) => {
        const tooltipElement = document.querySelector(selector);

        if (!tooltipElement) {
          return null;
        }

        return {
          ariaHidden: tooltipElement.getAttribute('aria-hidden'),
          visibility: (tooltipElement as HTMLElement).style.visibility,
        };
      }, TOOLTIP_INTERFACE_SELECTOR);

      expect(hiddenState).not.toBeNull();
      expect(hiddenState?.ariaHidden).toBe('true');
      expect(hiddenState?.visibility).toBe('hidden');
    });

    test('should update aria-hidden when tooltip class changes', async ({ page }) => {
      const testElement = await page.evaluate(({ holder }) => {
        const container = document.getElementById(holder);
        const element = document.createElement('span');

        element.textContent = 'Mutation target';
        element.id = 'mutation-target';
        container?.appendChild(element);

        return {
          id: element.id,
        };
      }, { holder: HOLDER_ID });

      await page.evaluate(({ elementId }) => {
        const blok = window.blokInstance;
        const element = document.getElementById(elementId);

        if (element && blok?.tooltip) {
          blok.tooltip.show(element, 'Mutation tooltip', {
            delay: 0,
          });
        }
      }, { elementId: testElement.id });

      await waitForTooltip(page);

      // Remove the opacity-100 class which triggers the MutationObserver to update aria-hidden
      await page.evaluate((selector) => {
        const tooltipElement = document.querySelector(selector);

        tooltipElement?.classList.remove('opacity-100');
      }, TOOLTIP_INTERFACE_SELECTOR);

      await page.waitForFunction((selector) => {
        const tooltipElement = document.querySelector(selector);

        return tooltipElement?.getAttribute('aria-hidden') === 'true';
      }, TOOLTIP_INTERFACE_SELECTOR);

      const state = await page.evaluate((selector) => {
        const tooltipElement = document.querySelector(selector);

        if (!tooltipElement) {
          return null;
        }

        return {
          ariaHidden: tooltipElement.getAttribute('aria-hidden'),
          visibility: (tooltipElement as HTMLElement).style.visibility,
        };
      }, TOOLTIP_INTERFACE_SELECTOR);

      expect(state).not.toBeNull();
      expect(state?.ariaHidden).toBe('true');
      expect(state?.visibility).toBe('hidden');
    });

    test('should apply placement offsets for left and right positions', async ({ page }) => {
      const testElement = await page.evaluate(({ holder }) => {
        const container = document.getElementById(holder);
        const element = document.createElement('div');

        element.textContent = 'Placement target';
        element.id = 'placement-target';
        element.style.margin = '200px';
        element.style.display = 'inline-block';
        element.style.padding = '16px';
        container?.appendChild(element);

        return {
          id: element.id,
        };
      }, { holder: HOLDER_ID });

      // Left placement without margin
      await page.evaluate(({ elementId }) => {
        const blok = window.blokInstance;
        const element = document.getElementById(elementId);

        if (element && blok?.tooltip) {
          blok.tooltip.show(element, 'Left placement', {
            placement: 'left',
            delay: 0,
          });
        }
      }, { elementId: testElement.id });

      await waitForTooltip(page);

      const leftPlacement = await page.evaluate((selector) => {
        const tooltipElement = document.querySelector(selector);

        if (!tooltipElement) {
          return null;
        }

        return {
          left: parseFloat((tooltipElement as HTMLElement).style.left),
          placement: tooltipElement.getAttribute('data-blok-placement'),
        };
      }, TOOLTIP_INTERFACE_SELECTOR);

      expect(leftPlacement).not.toBeNull();
      expect(leftPlacement?.placement).toBe('left');

      // Left placement with margin
      await page.evaluate(({ elementId }) => {
        const blok = window.blokInstance;
        const element = document.getElementById(elementId);

        if (element && blok?.tooltip) {
          blok.tooltip.show(element, 'Left margin placement', {
            placement: 'left',
            delay: 0,
            marginLeft: 40,
          });
        }
      }, { elementId: testElement.id });

      await waitForTooltip(page);

      const leftPlacementWithMargin = await page.evaluate((selector) => {
        const tooltipElement = document.querySelector(selector);

        if (!tooltipElement) {
          return null;
        }

        return parseFloat((tooltipElement as HTMLElement).style.left);
      }, TOOLTIP_INTERFACE_SELECTOR);

      expect(leftPlacementWithMargin).not.toBeNull();
      expect(leftPlacementWithMargin as number).toBeLessThan(leftPlacement?.left ?? Number.POSITIVE_INFINITY);

      // Right placement without margin
      await page.evaluate(({ elementId }) => {
        const blok = window.blokInstance;
        const element = document.getElementById(elementId);

        if (element && blok?.tooltip) {
          blok.tooltip.show(element, 'Right placement', {
            placement: 'right',
            delay: 0,
          });
        }
      }, { elementId: testElement.id });

      await waitForTooltip(page);

      const rightPlacement = await page.evaluate((selector) => {
        const tooltipElement = document.querySelector(selector);

        if (!tooltipElement) {
          return null;
        }

        return {
          left: parseFloat((tooltipElement as HTMLElement).style.left),
          placement: tooltipElement.getAttribute('data-blok-placement'),
        };
      }, TOOLTIP_INTERFACE_SELECTOR);

      expect(rightPlacement).not.toBeNull();
      expect(rightPlacement?.placement).toBe('right');

      // Right placement with margin
      await page.evaluate(({ elementId }) => {
        const blok = window.blokInstance;
        const element = document.getElementById(elementId);

        if (element && blok?.tooltip) {
          blok.tooltip.show(element, 'Right margin placement', {
            placement: 'right',
            delay: 0,
            marginRight: 40,
          });
        }
      }, { elementId: testElement.id });

      await waitForTooltip(page);

      const rightPlacementWithMargin = await page.evaluate((selector) => {
        const tooltipElement = document.querySelector(selector);

        if (!tooltipElement) {
          return null;
        }

        return parseFloat((tooltipElement as HTMLElement).style.left);
      }, TOOLTIP_INTERFACE_SELECTOR);

      expect(rightPlacementWithMargin).not.toBeNull();
      expect(rightPlacementWithMargin as number).toBeGreaterThan(rightPlacement?.left ?? Number.NEGATIVE_INFINITY);
    });
  });
});
