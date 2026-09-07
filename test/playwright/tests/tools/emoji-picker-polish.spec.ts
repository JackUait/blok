import type { Locator, Page } from '@playwright/test';
import { IconTrash } from '../../../../src/components/icons';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

const openCalloutPicker = async (page: Page): Promise<Locator> => {
  await page.evaluate(async () => {
    await window.blokInstance?.destroy?.();
    document.getElementById('blok')?.remove();
    const holder = document.createElement('div');

    holder.id = 'blok';
    document.body.appendChild(holder);
    window.blokInstance = new window.Blok({
      holder: 'blok',
      data: { blocks: [{ type: 'callout', data: { emoji: '💡', color: 'default' } }] },
    });
    await window.blokInstance.isReady;
  });
  await page.getByTestId('callout-emoji-btn').click();
  const picker = page.getByRole('dialog', { name: 'Edit icon' });

  await expect(picker).toBeVisible();
  await expect(picker.locator('[data-emoji-native]').first()).toBeVisible();
  await picker.evaluate((element) => element.getAnimations().forEach((animation) => animation.finish()));

  return picker;
};

const scrollEmojiTo = async (emoji: Locator, position: 'top' | 'center' | 'bottom'): Promise<void> => {
  await emoji.evaluate((button, target) => {
    const body = button.closest<HTMLElement>('[data-emoji-picker-body]');

    if (body === null) {
      throw new Error('Emoji has no scroll container');
    }

    const viewport = body.getBoundingClientRect();
    const rect = button.getBoundingClientRect();
    const offset = {
      center: viewport.height / 2,
      top: 8,
      bottom: viewport.height - 8,
    }[target];

    body.scrollTop += rect.top + rect.height / 2 - viewport.top - offset;
  }, position);
};

const readGlyph = async (emoji: Locator) => emoji.evaluate((button) => {
  const glyph = button.firstElementChild;
  const body = button.closest('[data-emoji-picker-body]');

  if (glyph === null || body === null) {
    return null;
  }

  const style = getComputedStyle(glyph);
  const rect = button.getBoundingClientRect();
  const viewport = body.getBoundingClientRect();

  return {
    transformed: style.transform !== 'none' && !new DOMMatrixReadOnly(style.transform).isIdentity,
    transform: style.transform,
    tilt: Math.abs(Math.atan2(new DOMMatrixReadOnly(style.transform).m23, new DOMMatrixReadOnly(style.transform).m22) * 180 / Math.PI),
    buttonTransformed: getComputedStyle(button).transform !== 'none'
      && !new DOMMatrixReadOnly(getComputedStyle(button).transform).isIdentity,
    width: rect.width,
    height: rect.height,
    clipped: rect.top < viewport.top || rect.bottom > viewport.bottom,
  };
});

test.beforeAll(() => {
  ensureBlokBundleBuilt();
});

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await gotoTestPage(page);
});

test('keeps search, empty results, and restored results the same size within narrow viewports', async ({ page }) => {
  const picker = await openCalloutPicker(page);
  const search = picker.getByRole('searchbox', { name: 'Search emojis…' });
  const body = picker.locator('[data-emoji-picker-body]');

  for (const width of [1280, 375, 320]) {
    await page.setViewportSize({ width, height: 800 });
    await expect.poll(async () => picker.evaluate((element) => {
      const rect = element.getBoundingClientRect();

      return rect.left >= 0 && rect.right <= window.innerWidth && rect.width <= 400;
    })).toBe(true);

    const initial = await picker.evaluate((element) => ({
      width: element.getBoundingClientRect().width,
      height: element.getBoundingClientRect().height,
    }));
    const bodyHeight = await body.evaluate((element) => element.getBoundingClientRect().height);

    await search.fill('bulb');
    await expect(body.locator('[data-emoji-native]')).not.toHaveCount(0);
    await expect.poll(() => picker.evaluate((element) => element.getBoundingClientRect().height)).toBe(initial.height);
    await expect.poll(() => body.evaluate((element) => element.getBoundingClientRect().height)).toBe(bodyHeight + 46);

    await search.fill('zzzznoemojimatcheszzzz');
    await expect(body.locator('[data-emoji-native]')).toHaveCount(0);
    await expect(body.getByText('No emojis found')).toBeVisible();
    const announcement = await picker.getByRole('status').boundingBox();

    expect(announcement?.width).toBeLessThanOrEqual(1);
    expect(announcement?.height).toBeLessThanOrEqual(1);
    await expect.poll(() => picker.evaluate((element) => element.getBoundingClientRect().height)).toBe(initial.height);
    await expect.poll(() => body.evaluate((element) => element.getBoundingClientRect().height)).toBe(bodyHeight + 46);
    await expect.poll(() => picker.evaluate((element) => element.getBoundingClientRect().width)).toBe(initial.width);

    await search.clear();
    await expect(body.locator('[data-emoji-native="💡"]')).toBeVisible();
    await expect.poll(() => picker.evaluate((element) => element.getBoundingClientRect().height)).toBe(initial.height);
  }
});

test('curls only inner glyphs at both clipped edges and leaves the center and hit targets stable', async ({ page }) => {
  const picker = await openCalloutPicker(page);
  const emoji = picker.locator('[data-emoji-native]').nth(80);

  await scrollEmojiTo(emoji, 'center');
  await expect.poll(() => readGlyph(emoji)).toMatchObject({ transformed: false, buttonTransformed: false, clipped: false });
  const center = await readGlyph(emoji);

  await scrollEmojiTo(emoji, 'top');
  await expect.poll(() => readGlyph(emoji)).toMatchObject({ transformed: true, buttonTransformed: false, clipped: true });
  const top = await readGlyph(emoji);

  await scrollEmojiTo(emoji, 'bottom');
  await expect.poll(() => readGlyph(emoji)).toMatchObject({ transformed: true, buttonTransformed: false, clipped: true });
  const bottom = await readGlyph(emoji);

  expect(top?.tilt).toBeGreaterThan(30);
  expect(top?.tilt).toBeLessThan(42);
  expect(bottom?.tilt).toBeGreaterThan(30);
  expect(bottom?.tilt).toBeLessThan(42);
  expect(bottom?.transform).not.toBe(top?.transform);
  expect(top?.width).toBe(center?.width);
  expect(top?.height).toBe(center?.height);
  expect(bottom?.width).toBe(center?.width);
  expect(bottom?.height).toBe(center?.height);

  await scrollEmojiTo(emoji, 'center');
  await expect.poll(() => readGlyph(emoji)).toMatchObject({ transformed: false, buttonTransformed: false, clipped: false });
});

test('scrolls emoji directly beneath the search field without a blank header stripe', async ({ page }) => {
  const picker = await openCalloutPicker(page);
  const emoji = picker.locator('[data-emoji-native]').nth(80);

  await scrollEmojiTo(emoji, 'top');
  const gap = await picker.evaluate((root) => {
    const input = root.querySelector('input');
    const body = root.querySelector('[data-emoji-picker-body]');

    if (input === null || body === null) {
      throw new Error('Missing picker layout');
    }

    return body.getBoundingClientRect().top - input.getBoundingClientRect().bottom;
  });

  expect(gap).toBeLessThanOrEqual(1);
});

test('keeps emoji hit targets still when hovering and pressing the glyph', async ({ page }) => {
  const picker = await openCalloutPicker(page);
  const emoji = picker.locator('[data-emoji-native="💡"]');
  const before = await emoji.boundingBox();

  await emoji.hover();
  await expect(emoji).toHaveCSS('scale', 'none');
  expect(await emoji.boundingBox()).toEqual(before);

  await page.mouse.down();
  await expect(emoji).toHaveCSS('scale', 'none');
  expect(await emoji.boundingBox()).toEqual(before);
  await page.mouse.move(0, 0);
  await page.mouse.up();
});

test('reduced motion disables edge curl and opening and empty-state animations', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const picker = await openCalloutPicker(page);
  const emoji = picker.locator('[data-emoji-native]').nth(80);

  await scrollEmojiTo(emoji, 'top');
  await expect.poll(() => readGlyph(emoji)).toMatchObject({ transformed: false, buttonTransformed: false, clipped: true });
  await scrollEmojiTo(emoji, 'bottom');
  await expect.poll(() => readGlyph(emoji)).toMatchObject({ transformed: false, buttonTransformed: false, clipped: true });

  await picker.getByRole('searchbox').fill('zzzznoemojimatcheszzzz');
  await expect(picker.locator('[data-emoji-picker-body]').getByText('No emojis found')).toBeVisible();
  const animatedElements = await picker.evaluate((root) => [root, ...root.querySelectorAll('*')].filter((element) => {
    const style = getComputedStyle(element);

    return (style.animationName !== 'none' && style.animationDuration.split(',').some((duration) => parseFloat(duration) > 0))
      || style.transitionDuration.split(',').some((duration) => parseFloat(duration) > 0);
  }).length);

  expect(animatedElements).toBe(0);
});

test('names emoji buttons and supports search-to-grid arrow navigation and keyboard selection', async ({ page }) => {
  const picker = await openCalloutPicker(page);
  const search = picker.getByRole('searchbox', { name: 'Search emojis…' });
  const first = picker.locator('[data-emoji-native="💡"]');
  const second = picker.locator('[data-emoji-native="👉"]');
  const nextRow = picker.locator('[data-emoji-native="🚫"]');

  await expect(first).toHaveAccessibleName(/light bulb/i);
  await expect(second).toHaveAccessibleName(/right/i);
  await expect(search).toBeFocused();
  await search.press('ArrowDown');
  await expect(first).toBeFocused();
  await first.press('ArrowRight');
  await expect(second).toBeFocused();
  await second.press('ArrowLeft');
  await expect(first).toBeFocused();
  await first.press('ArrowDown');
  await expect(nextRow).toBeFocused();
  await nextRow.press('ArrowUp');
  await expect(first).toBeFocused();
  await first.press('ArrowRight');
  await second.press('Enter');
  await expect(picker).not.toBeVisible();
  await expect(page.getByTestId('callout-emoji-btn')).toHaveText('👉');
});

test('cycles Tab through picker controls without editor interception or arrow focus escape', async ({ page }) => {
  const picker = await openCalloutPicker(page);
  const search = picker.getByRole('searchbox');
  const toggle = picker.getByRole('button', { name: 'Skin tone', exact: true });

  await expect(search).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(toggle).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(toggle).toBeFocused();

  const controls = [
    picker.getByRole('button', { name: 'Pick a random emoji', exact: true }),
    picker.getByRole('button', { name: 'Remove icon', exact: true }),
    picker.locator('[data-emoji-native]').first(),
    ...await picker.locator('[data-emoji-nav]').all(),
    search,
  ];

  for (const control of controls) {
    await page.keyboard.press('Tab');
    await expect(control).toBeFocused();
  }

  await page.keyboard.press('Shift+Tab');
  await expect(picker.getByRole('button', { name: 'Flags', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(picker).not.toBeVisible();
  await expect(page.getByTestId('callout-emoji-btn')).toBeFocused();
});

test('wraps search-result and empty-state focus around visible controls only', async ({ page }) => {
  const picker = await openCalloutPicker(page);
  const search = picker.getByRole('searchbox');

  await search.fill('zzzznoemojimatcheszzzz');
  const back = picker.locator('[data-emoji-picker-empty]').getByRole('button', { name: 'Clear search', exact: true });

  await expect(back).toBeVisible();
  await page.keyboard.press('Shift+Tab');
  await expect(back).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(search).toBeFocused();

  await page.keyboard.press('Tab');
  await expect(picker.locator('[data-emoji-picker-clear]')).toBeFocused();
  for (const name of ['Skin tone', 'Pick a random emoji', 'Remove icon']) {
    await page.keyboard.press('Tab');
    await expect(picker.getByRole('button', { name, exact: true })).toBeFocused();
  }
  await page.keyboard.press('Tab');
  await expect(back).toBeFocused();

  await page.keyboard.press('Enter');
  await expect(search).toBeFocused();
  await expect(search).toHaveValue('');

  await search.fill('bulb');
  const result = picker.getByRole('button', { name: 'light bulb', exact: true });

  await expect(result).toBeVisible();
  await page.keyboard.press('Shift+Tab');
  await expect(result).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(search).toBeFocused();
});

test('clears search inline and keeps match counts offscreen with an actionable empty state', async ({ page }) => {
  const picker = await openCalloutPicker(page);
  const search = picker.getByRole('searchbox');
  const clear = picker.locator('[data-emoji-picker-clear]');
  const footer = picker.locator('[data-emoji-picker-footer]');

  await expect(clear).toBeHidden();
  await search.fill('love');
  await expect(footer).toBeHidden();
  await expect(picker.getByRole('status')).toContainText('Emoji matches:');
  const announcement = await picker.getByRole('status').boundingBox();

  expect(announcement?.width).toBeLessThanOrEqual(1);
  expect(announcement?.height).toBeLessThanOrEqual(1);
  await expect(clear).toHaveAccessibleName('Clear search');

  await page.setViewportSize({ width: 320, height: 640 });
  const searchRect = await search.boundingBox();
  const clearRect = await clear.boundingBox();

  expect(clearRect?.width).toBeGreaterThanOrEqual(24);
  expect(clearRect?.x).toBeGreaterThan(searchRect?.x ?? 0);
  expect((clearRect?.x ?? 0) + (clearRect?.width ?? 0)).toBeLessThanOrEqual((searchRect?.x ?? 0) + (searchRect?.width ?? 0));

  await clear.click();
  await expect(search).toHaveValue('');
  await expect(search).toBeFocused();
  await expect(clear).toBeHidden();
  await expect(footer).toBeVisible();

  await search.fill('zzzznoemojimatcheszzzz');
  const empty = picker.locator('[data-emoji-picker-empty]');

  await expect(empty.getByText('No emojis found', { exact: true })).toBeVisible();
  await expect(empty.getByText('Try a different word or clear the search.', { exact: true })).toBeVisible();
  await empty.getByRole('button', { name: 'Clear search', exact: true }).click();
  await expect(search).toHaveValue('');
  await expect(search).toBeFocused();
  await expect(empty).toHaveCount(0);
});

test('moves the section highlight straight to the clicked category throughout smooth scrolling', async ({ page }) => {
  const picker = await openCalloutPicker(page);

  for (const category of ['symbols', 'callout', 'foods', 'flags']) {
    const trace = await picker.evaluate(async (root, id) => {
      const body = root.querySelector<HTMLElement>('[data-emoji-picker-body]');
      const section = root.querySelector<HTMLElement>(`[data-emoji-section="${id}"]`);
      const button = root.querySelector<HTMLButtonElement>(`[data-emoji-nav="${id}"]`);

      if (body === null || section === null || button === null) {
        throw new Error('Missing category navigation');
      }

      const target = Math.min(section.offsetTop, body.scrollHeight - body.clientHeight);
      const selected = (): string | null => root.querySelector('[data-emoji-nav][aria-current="true"]')?.getAttribute('data-emoji-nav') ?? null;

      button.click();
      const immediate = selected();
      const visited = [immediate];
      const started = performance.now();

      await new Promise<void>((resolve, reject) => {
        const sample = (): void => {
          const active = selected();

          if (visited.at(-1) !== active) {
            visited.push(active);
          }

          if (Math.abs(body.scrollTop - target) <= 1) {
            resolve();
          } else if (performance.now() - started > 4000) {
            reject(new Error('Category scroll did not reach its target'));
          } else {
            requestAnimationFrame(sample);
          }
        };

        requestAnimationFrame(sample);
      });

      return { immediate, visited };
    }, category);

    expect(trace.immediate).toBe(category);
    expect(trace.visited).toEqual([category]);
  }

  await picker.locator('[data-emoji-picker-body]').evaluate((body) => {
    body.scrollTo({ top: 0, behavior: 'instant' });
  });
  await expect(picker.locator('[data-emoji-nav="callout"]')).toHaveAttribute('aria-current', 'true');
});

test('announces skin-tone expansion, restores focus, and removes the icon with the shared trash glyph', async ({ page }) => {
  const picker = await openCalloutPicker(page);
  const toggle = picker.getByRole('button', { name: 'Skin tone', exact: true });
  const tones = picker.locator('[data-emoji-picker-skin-tone]');
  const remove = picker.getByRole('button', { name: 'Remove icon', exact: true });
  const usesTrash = await remove.evaluate((button, trash) => {
    const template = document.createElement('template');

    template.innerHTML = trash;

    return button.querySelector('svg')?.isEqualNode(template.content.querySelector('svg')) ?? false;
  }, IconTrash);

  expect(usesTrash).toBe(true);
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(tones).toBeVisible();
  await tones.getByRole('button', { name: 'Skin tone 4', exact: true }).click();
  await expect(toggle).toHaveText('✋🏽');
  await expect(picker.locator('[data-emoji-native="👉"]')).toHaveText('👉🏽');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(toggle).toBeFocused();
  await expect(tones).not.toBeVisible();

  await toggle.press('Enter');
  await tones.getByRole('button', { name: 'Skin tone 4', exact: true }).focus();
  await page.keyboard.press('Escape');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(toggle).toBeFocused();
  await expect(picker).toBeVisible();

  await remove.click();
  await expect(picker).not.toBeVisible();
  await expect(page.getByTestId('callout-emoji-btn')).toHaveText('');
});
