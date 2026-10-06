import type { Page } from '@playwright/test';

import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

const HOLDER_ID = 'blok';

declare global {
  interface Window {
    blokInstance?: Blok;
    Blok: new (...args: unknown[]) => Blok;
    mermaidPwned?: boolean;
    mermaidCallback?: () => void;
  }
}

test.beforeAll(ensureBlokBundleBuilt);

// Mermaid and its diagram chunks load lazily on first render.
const RENDER_TIMEOUT = 15_000;

const createBlok = async (page: Page, blocks: OutputData['blocks'], readOnly = false): Promise<void> => {
  await page.evaluate(async ({ holder, blokBlocks, isReadOnly }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById(holder)?.remove();

    const container = document.createElement('div');

    container.id = holder;
    container.style.width = '720px';
    document.body.appendChild(container);

    const blok = new window.Blok({ holder, readOnly: isReadOnly, data: { blocks: blokBlocks } });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID, blokBlocks: blocks, isReadOnly: readOnly });
};

const mermaidBlock = (code: string): OutputData['blocks'][number] => ({
  type: 'code',
  data: { code, language: 'mermaid' },
});

const preview = (page: Page) => page.getByTestId('code-preview');

// Mermaid tags every diagram svg role="graphics-document document".
const diagram = (page: Page) => preview(page).getByRole('document');

// Both error paths in mermaid-loader put a bare <span> where the svg goes.
const previewRoot = async (page: Page): Promise<string | undefined> =>
  preview(page).evaluate((element) => element.firstElementChild?.localName);

const waitForDiagram = async (page: Page, labels: string[]): Promise<void> => {
  await expect(diagram(page)).toBeVisible({ timeout: RENDER_TIMEOUT });

  for (const label of labels) {
    await expect(diagram(page)).toContainText(label);
  }
};

test.describe('code block mermaid preview', () => {
  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
  });

  test('renders a flowchart as an svg with its node labels', async ({ page }) => {
    await createBlok(page, [mermaidBlock('graph TD; A[Start]-->B[End]')]);

    await waitForDiagram(page, ['Start', 'End']);
    expect(await previewRoot(page)).toBe('svg');
  });

  test('renders a sequence diagram', async ({ page }) => {
    await createBlok(page, [mermaidBlock('sequenceDiagram\n  Alice->>Bob: Hello Bob\n  Bob-->>Alice: Hi Alice')]);

    await waitForDiagram(page, ['Alice', 'Bob', 'Hello Bob', 'Hi Alice']);
    expect(await previewRoot(page)).toBe('svg');
  });

  test('renders a class diagram', async ({ page }) => {
    await createBlok(page, [mermaidBlock('classDiagram\n  Animal <|-- Duck\n  Animal : +int age\n  Duck : +swim()')]);

    await waitForDiagram(page, ['Animal', 'Duck', 'age', 'swim']);
    expect(await previewRoot(page)).toBe('svg');
  });

  test('renders a state diagram', async ({ page }) => {
    await createBlok(page, [mermaidBlock('stateDiagram-v2\n  [*] --> Idle\n  Idle --> Running\n  Running --> [*]')]);

    await waitForDiagram(page, ['Idle', 'Running']);
    expect(await previewRoot(page)).toBe('svg');
  });

  test('shows an error instead of a diagram for invalid syntax', async ({ page }) => {
    await createBlok(page, [mermaidBlock('graph TD; A[Start-->')]);

    await expect(preview(page)).toContainText('Invalid Mermaid syntax', { timeout: RENDER_TIMEOUT });
    expect(await previewRoot(page)).toBe('span');
    await expect(diagram(page)).toHaveCount(0);
  });

  test('strict security level keeps scripts and click handlers out of the diagram', async ({ page }) => {
    await page.evaluate(() => {
      window.mermaidPwned = false;
      window.mermaidCallback = () => {
        window.mermaidPwned = true;
      };
    });

    await createBlok(page, [mermaidBlock([
      'graph TD',
      '  A["<img src=x onerror=\'window.mermaidPwned=true\'>Alpha"]-->B["<a href=\'javascript:window.mermaidPwned=true\'>Beta</a>"]',
      '  B-->C["<script>window.mermaidPwned=true</script>Gamma"]',
      '  click A mermaidCallback',
      '  click C "javascript:window.mermaidPwned=true"',
    ].join('\n'))]);

    await waitForDiagram(page, ['Alpha', 'Beta', 'Gamma']);
    expect(await previewRoot(page)).toBe('svg');

    const svg = diagram(page);

    await svg.getByText('Alpha').click();
    await svg.getByText('Beta').click();
    await svg.getByText('Gamma').click();

    const markup = await svg.evaluate((element) => element.outerHTML);

    expect(markup).not.toMatch(/<script/i);
    expect(markup).not.toMatch(/javascript:/i);
    expect(markup).not.toMatch(/\son(error|click|load)=/i);
    expect(await page.evaluate(() => window.mermaidPwned)).toBe(false);
  });

  test('re-renders the same diagram after a save and reload, leaving the data unchanged', async ({ page }) => {
    const code = 'graph TD; A[Start]-->B[End]';

    await createBlok(page, [mermaidBlock(code)]);
    await waitForDiagram(page, ['Start', 'End']);
    expect(await previewRoot(page)).toBe('svg');

    const saved = await page.evaluate(async () => window.blokInstance?.save());

    expect(saved?.blocks).toHaveLength(1);
    expect(saved?.blocks[0].data).toMatchObject({ code, language: 'mermaid' });

    await createBlok(page, saved?.blocks ?? []);
    await waitForDiagram(page, ['Start', 'End']);
    expect(await previewRoot(page)).toBe('svg');

    const resaved = await page.evaluate(async () => window.blokInstance?.save());

    expect(resaved?.blocks[0].data).toStrictEqual(saved?.blocks[0].data);
  });

  test('renders the diagram in read-only mode', async ({ page }) => {
    await createBlok(page, [mermaidBlock('graph TD; A[Start]-->B[End]')], true);

    await waitForDiagram(page, ['Start', 'End']);
    expect(await previewRoot(page)).toBe('svg');
  });
});
