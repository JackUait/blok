import type { Locator, Page } from '@playwright/test';

import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

const finishAnimations = async (picker: Locator): Promise<void> => {
  await picker.evaluate((root) => {
    root.getAnimations({ subtree: true }).forEach((animation) => animation.finish());
  });
};

const expectNoMotion = async (picker: Locator): Promise<void> => {
  expect(await picker.evaluate((root) => ({
    animations: root.getAnimations({ subtree: true }).length,
    movingStyles: [root, ...root.querySelectorAll('*')].filter((element) => {
      const style = getComputedStyle(element);

      return (style.animationName !== 'none' && style.animationDuration.split(',').some((duration) => parseFloat(duration) > 0))
        || style.transitionDuration.split(',').some((duration) => parseFloat(duration) > 0);
    }).length,
  }))).toEqual({ animations: 0, movingStyles: 0 });
};

const openPicker = async (page: Page, mode: 'callout' | 'colon' = 'callout'): Promise<Locator> => {
  await page.evaluate(async (kind) => {
    await window.blokInstance?.destroy?.();
    document.getElementById('blok')?.remove();
    const holder = document.createElement('div');

    holder.id = 'blok';
    document.body.appendChild(holder);
    window.blokInstance = new window.Blok({
      holder: 'blok',
      data: { blocks: [kind === 'callout'
        ? { type: 'callout', data: { emoji: '💡', color: 'default' } }
        : { type: 'paragraph', data: { text: '' } }] },
    });
    await window.blokInstance.isReady;
  }, mode);

  if (mode === 'callout') {
    await page.getByTestId('callout-emoji-btn').click();
  } else {
    const paragraph = page.locator('[data-blok-component="paragraph"]');

    await paragraph.click();
    await paragraph.pressSequentially(':a');
  }

  const picker = mode === 'callout'
    ? page.getByRole('dialog', { name: 'Edit icon' })
    : page.getByTestId('emoji-menu');

  await expect(picker).toBeVisible();
  await expect(picker.locator('[data-emoji-native]').first()).toBeVisible();
  if (await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)) {
    await expectNoMotion(picker);
  } else {
    await finishAnimations(picker);
  }

  return picker;
};

const scrollTo = async (item: Locator, edge: 'center' | 'top' | 'bottom'): Promise<void> => {
  await item.evaluate(async (element, position) => {
    const body = element.closest<HTMLElement>('[data-emoji-picker-body]');

    if (body === null) {
      throw new Error('Missing emoji scroll container');
    }

    const rect = element.getBoundingClientRect();
    const viewport = body.getBoundingClientRect();
    const offset = { center: viewport.height / 2, top: 6, bottom: viewport.height - 6 }[position];

    body.scrollTop += rect.top + rect.height / 2 - viewport.top - offset;
    // The scroll handler schedules its reel update on the next frame.
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  }, edge);
};

const readCurl = async (title: Locator) => title.evaluate((element) => {
  const transformed = [element, ...element.querySelectorAll('*')]
    .map((node) => new DOMMatrixReadOnly(getComputedStyle(node).transform))
    .find((matrix) => Math.abs(matrix.m23) > 0.001);

  return {
    tilt: transformed?.m23 ?? 0,
    width: element instanceof HTMLElement ? element.offsetWidth : 0,
    height: element instanceof HTMLElement ? element.offsetHeight : 0,
  };
});

const selectToneAndPause = async (tone: Locator) => tone.evaluate(async (button) => {
  const root = button.closest('[data-blok-emoji-picker]');
  const body = root?.querySelector<HTMLElement>('[data-emoji-picker-body]');
  const wave = root?.querySelector<HTMLElement>('[data-emoji-native="👋"]');

  if (root == null || body == null || wave == null || !(button instanceof HTMLButtonElement)) {
    throw new Error('Missing tone selection controls');
  }

  const beforeRect = wave.getBoundingClientRect();
  const before = { rect: { x: beforeRect.x, y: beforeRect.y, width: beforeRect.width, height: beforeRect.height }, scroll: body.scrollTop };
  const viewport = body.getBoundingClientRect();
  const initialGlyphs = new Map([...body.querySelectorAll('[data-emoji-native]')].map((emoji) => {
    const rect = emoji.getBoundingClientRect();

    return [emoji, {
      text: emoji.textContent,
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      inViewport: rect.bottom > viewport.top && rect.top < viewport.bottom,
    }];
  }));

  // Capture real browser animations before a fast transition can finish.
  button.click();
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  const animations = root.getAnimations({ subtree: true }).filter((animation) => animation.playState !== 'finished');

  animations.forEach((animation) => animation.pause());
  const motion = animations.flatMap((animation) => {
    const effect = animation.effect;

    if (!(effect instanceof KeyframeEffect) || !(effect.target instanceof Element)) {
      return [];
    }

    const currentAnimation = animation;
    const target = effect.target;
    const timing = effect.getComputedTiming();
    const duration = Number(timing.duration);

    if (!Number.isFinite(duration) || duration <= 0) {
      return [];
    }

    const emoji = target.closest('[data-emoji-native]');
    const initialGlyph = emoji === null ? undefined : initialGlyphs.get(emoji);
    let stableTarget = true;
    const sample = (progress: number): string => {
      currentAnimation.currentTime = (timing.delay ?? 0) + duration * progress;
      const style = getComputedStyle(target);
      const rect = emoji?.getBoundingClientRect();

      stableTarget &&= body.scrollTop === before.scroll && (rect === undefined || (initialGlyph !== undefined
        && rect.x === initialGlyph.rect.x && rect.y === initialGlyph.rect.y
        && rect.width === initialGlyph.rect.width && rect.height === initialGlyph.rect.height));

      return [style.transform, style.translate, style.scale, style.rotate, style.opacity].join('|');
    };
    const changed = new Set([0, 0.2, 0.5, 0.8, 1].map(sample)).size > 1;

    currentAnimation.currentTime = (timing.delay ?? 0) + duration * 0.5;

    return [{
      changed,
      stableTarget,
      native: target.closest('[data-emoji-native]')?.getAttribute('data-emoji-native') ?? null,
      toneControl: target.closest('[data-emoji-picker-skin-tone], [data-emoji-picker-skin-toggle]') !== null,
      inViewport: initialGlyph?.inViewport ?? false,
      textChanged: initialGlyph !== undefined && initialGlyph.text !== emoji?.textContent,
    }];
  });

  const afterRect = wave.getBoundingClientRect();

  return {
    motion,
    before,
    after: { rect: { x: afterRect.x, y: afterRect.y, width: afterRect.width, height: afterRect.height }, scroll: body.scrollTop },
    sameButton: root.querySelector('[data-emoji-native="👋"]') === wave,
  };
});

test.beforeAll(() => {
  ensureBlokBundleBuilt();
});

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ reducedMotion: 'no-preference', colorScheme: 'light' });
  await gotoTestPage(page);
});

test('animates tone selection and visible glyph swaps without moving or replacing click targets', async ({ page }) => {
  const picker = await openPicker(page);
  const wave = picker.locator('[data-emoji-native="👋"]');

  await scrollTo(wave, 'center');
  await expect(wave).toBeInViewport();
  await picker.locator('[data-emoji-picker-skin-toggle]').click();
  const tray = picker.locator('[data-emoji-picker-skin-tone]');

  await expect(tray).toBeVisible();
  await finishAnimations(picker);
  const result = await selectToneAndPause(tray.getByRole('button', { name: 'Skin tone 4', exact: true }));

  expect.soft(result.motion.some((motion) => motion.toneControl && motion.changed)).toBe(true);
  expect.soft(result.motion.some((motion) => motion.native === '👋' && motion.changed)).toBe(true);
  expect(result.motion.filter((motion) => motion.native !== null && (!motion.inViewport || !motion.textChanged))).toEqual([]);
  expect(result.motion.every((motion) => motion.stableTarget)).toBe(true);
  expect(result.sameButton).toBe(true);
  expect(result.before.scroll).toBeGreaterThan(0);
  expect(result.after).toEqual(result.before);

  await finishAnimations(tray);
  await expect(wave.locator('[data-emoji-glyph]')).toHaveText('👋🏽');
  await expect(picker.locator('[data-emoji-native="👉"] [data-emoji-glyph]')).toHaveText('👉🏽');
  await expect(picker.locator('[data-emoji-native="😀"] [data-emoji-glyph]')).toHaveText('😀');
  await expect(picker.locator('[data-emoji-picker-skin-toggle]')).toHaveText('✋🏽');
  await expect(tray).toBeHidden();
  await wave.click();
  await expect(page.getByTestId('callout-emoji-btn')).toHaveText('👋🏽');
  await expect(picker).toBeHidden();
});

test('keeps the colon tone control beside the first section title at 320px in dark mode', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.emulateMedia({ colorScheme: 'dark' });
  const picker = await openPicker(page, 'colon');
  const toggle = picker.locator('[data-emoji-picker-skin-toggle]');

  await expect(picker).toHaveAttribute('data-theme', 'dark');
  await expect(picker.getByRole('searchbox')).toBeHidden();
  await expect(picker.getByRole('button', { name: 'Pick a random emoji', exact: true })).toBeHidden();
  await expect(picker.getByRole('button', { name: 'Remove icon', exact: true })).toBeHidden();
  await expect(picker.locator('[data-emoji-section="callout"], [data-emoji-nav="callout"]')).toHaveCount(0);
  const layout = await picker.evaluate((root) => {
    const body = root.querySelector('[data-emoji-picker-body]');
    const title = root.querySelector('[data-emoji-section-title]');
    const control = root.querySelector('[data-emoji-picker-skin-toggle]');

    if (body === null || title === null || control === null) {
      throw new Error('Missing colon picker layout');
    }

    const pickerRect = root.getBoundingClientRect();
    const titleRect = (title.firstElementChild ?? title).getBoundingClientRect();
    const toggleRect = control.getBoundingClientRect();

    return {
      topGap: body.getBoundingClientRect().top - pickerRect.top,
      sameRow: toggleRect.top < titleRect.bottom && toggleRect.bottom > titleRect.top,
      titleBeforeControl: titleRect.right <= toggleRect.left,
      inside: pickerRect.left >= 0 && pickerRect.right <= innerWidth,
    };
  });

  expect(layout).toMatchObject({ sameRow: true, titleBeforeControl: true, inside: true });
  expect(layout.topGap).toBeLessThanOrEqual(12);
  await toggle.click();
  await expect(page.locator('[data-blok-tool="paragraph"][contenteditable="true"]')).toBeFocused();
  const tray = picker.locator('[data-emoji-picker-skin-tone]');

  await expect(tray).toBeVisible();
  await finishAnimations(picker);
  for (const tone of await tray.getByRole('button').all()) {
    await expect(tone).toBeInViewport({ ratio: 1 });
  }
  await tray.getByRole('button', { name: 'Skin tone 4', exact: true }).click();
  await expect(page.locator('[data-blok-tool="paragraph"][contenteditable="true"]')).toBeFocused();
  await finishAnimations(picker);
  const wave = picker.locator('[data-emoji-native="👋"]');

  expect(await picker.locator('[data-emoji-picker-body]').evaluate((body) => body.scrollHeight > body.clientHeight)).toBe(true);
  await expect(wave).toHaveCount(1);
  await scrollTo(wave, 'center');
  await expect(toggle).not.toBeInViewport();
  await wave.click();
  await expect(page.locator('[data-blok-component="paragraph"]')).toHaveText('👋🏽');
  await expect(picker).toBeHidden();
});

test('curls section titles at both scroll edges without changing their layout size', async ({ page }) => {
  const picker = await openPicker(page);
  const title = picker.locator('[data-emoji-section-title]').nth(2);

  await scrollTo(title, 'center');
  await expect.poll(async () => (await readCurl(title)).tilt).toBe(0);
  const center = await readCurl(title);

  await scrollTo(title, 'top');
  await expect.poll(async () => Math.abs((await readCurl(title)).tilt)).toBeGreaterThan(0.05);
  const top = await readCurl(title);

  await scrollTo(title, 'bottom');
  await expect.poll(async () => (await readCurl(title)).tilt * top.tilt).toBeLessThan(0);
  const bottom = await readCurl(title);

  expect({ width: top.width, height: top.height }).toEqual({ width: center.width, height: center.height });
  expect({ width: bottom.width, height: bottom.height }).toEqual({ width: center.width, height: center.height });
  await scrollTo(title, 'center');
  await expect.poll(async () => (await readCurl(title)).tilt).toBe(0);
});

test('keeps decorative Callout empty results and the clear action usable at 320px in dark mode', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.emulateMedia({ colorScheme: 'dark' });
  const picker = await openPicker(page);
  const search = picker.getByRole('searchbox');
  const initial = await picker.boundingBox();

  await search.fill('zzzznoemojimatcheszzzz');
  const empty = picker.locator('[data-emoji-picker-empty]');
  const clear = empty.getByRole('button', { name: 'Clear search', exact: true });

  await expect(picker).toHaveAttribute('data-theme', 'dark');
  await expect(empty.getByText('No emojis found', { exact: true })).toBeVisible();
  await expect(empty.locator('[aria-hidden="true"]').first()).toBeVisible();
  await expect(clear).toBeInViewport({ ratio: 1 });
  await finishAnimations(picker);
  const geometry = await clear.evaluate((button) => {
    const rect = button.getBoundingClientRect();

    return { width: rect.width, height: rect.height, hit: button.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)) };
  });

  expect(geometry.width).toBeGreaterThanOrEqual(24);
  expect(geometry.height).toBeGreaterThanOrEqual(24);
  expect(geometry.hit).toBe(true);
  expect(await picker.boundingBox()).toEqual(initial);
  await clear.click();
  await expect(search).toHaveValue('');
  await expect(search).toBeFocused();
  await expect(empty).toHaveCount(0);
  await picker.locator('[data-emoji-native="💡"]').click();
  await expect(picker).toBeHidden();
  await expect(page.getByTestId('callout-emoji-btn')).toHaveText('💡');
});

test('reduced motion changes tone and clears empty results without running decorative animations', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const picker = await openPicker(page);
  const wave = picker.locator('[data-emoji-native="👋"]');
  const title = picker.locator('[data-emoji-section-title]').nth(2);

  for (const edge of ['top', 'bottom'] as const) {
    await scrollTo(title, edge);
    await expect.poll(async () => (await readCurl(title)).tilt).toBe(0);
  }
  await scrollTo(wave, 'center');
  await picker.locator('[data-emoji-picker-skin-toggle]').click();
  await expectNoMotion(picker.locator('[data-emoji-picker-skin-tone]'));
  const result = await selectToneAndPause(picker.locator('[data-emoji-picker-skin-tone]').getByRole('button', { name: 'Skin tone 4', exact: true }));

  expect(result.motion).toEqual([]);
  expect(result.sameButton).toBe(true);
  expect(result.after).toEqual(result.before);
  await expect(wave.locator('[data-emoji-glyph]')).toHaveText('👋🏽');
  const search = picker.getByRole('searchbox');

  await search.fill('zzzznoemojimatcheszzzz');
  const empty = picker.locator('[data-emoji-picker-empty]');

  await expect(empty).toBeVisible();
  await expectNoMotion(empty);
  await empty.getByRole('button', { name: 'Clear search', exact: true }).click();
  await expect(search).toHaveValue('');
  await expect(search).toBeFocused();
  await picker.locator('[data-emoji-native="👉"]').click();
  await expect(page.getByTestId('callout-emoji-btn')).toHaveText('👉🏽');
});
