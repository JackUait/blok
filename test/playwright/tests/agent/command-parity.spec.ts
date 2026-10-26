import { readFileSync } from 'node:fs';

import type { Blok, OutputData } from '@/types';

import { expect, gotoTestPage, test } from '../helpers/shared-page';
import { callerChosenIds, expectationFor, goldenPath, loadParityCases } from '../../../unit/agent/parity/corpus';
import type { CorpusBatch } from '../../../unit/agent/parity/corpus';
import { normalizeForParity, stableStringify } from '../../../unit/agent/parity/normalize';

declare global {
  interface Window {
    blokInstance?: Blok;
    Blok: new (...args: unknown[]) => Blok;
    BlokParagraph: unknown;
  }
}

// The json runner owns the goldens; this runner only reads them.
const goldenDocument = (name: string): unknown => {
  const value: unknown = JSON.parse(readFileSync(goldenPath(name), 'utf8'));

  return value !== null && typeof value === 'object' && 'document' in value ? value.document : undefined;
};

for (const c of loadParityCases()) {
  test(`editor runner: ${c.name}`, async ({ page }) => {
    await gotoTestPage(page);
    await page.waitForFunction(() => typeof window.Blok === 'function');

    const preview = c.services?.linkMetadata;

    // The browser's linkMetadata service is the bookmark tool's endpoint (test.html: /__unfurl).
    // Answer it with the case's fixed preview, as hostServicesFor does for the jsdom runner.
    if (preview !== undefined) {
      await page.route((url) => url.pathname === '/__unfurl', (route) => route.fulfill({
        json: {
          success: 1,
          meta: {
            title: preview.title,
            description: preview.description,
            image: preview.image === undefined ? undefined : { url: preview.image },
            favicon: preview.favicon,
            domain: preview.domain,
          },
        },
      }));
    }

    const run = await page.evaluate(async ({ seed, batches }: { seed: OutputData; batches: CorpusBatch[] }) => {
      document.getElementById('blok')?.remove();
      const holder = document.createElement('div');

      holder.id = 'blok';
      holder.setAttribute('data-blok-testid', 'blok');
      document.body.appendChild(holder);

      // test.html's default paragraph sets preserveBlank, which saves the editor's
      // starting empty paragraph. The json and jsdom runners use the stock paragraph.
      // The goldens credit the person human-1 with agent-test as co-author. Ask AI takes the
      // person from user.id, as the jsdom runner's editor does.
      const blok = new window.Blok({
        holder: 'blok',
        data: seed,
        user: { id: 'human-1' },
        tools: { paragraph: { class: window.BlokParagraph, inlineToolbar: true } },
      });

      window.blokInstance = blok;
      await blok.isReady;

      const turn = blok.agent.begin({ agent: { id: 'agent-test', name: 'Parity' } });
      // Corpus names are plain strings; an unknown name must reach the turn as written.
      const runner: { execute(batch: CorpusBatch): ReturnType<typeof turn.execute> } = turn;
      const state: { error: string | null } = { error: null };

      for (const batch of batches) {
        const result = await runner.execute(batch);

        if (!result.ok) {
          state.error = result.error.code;
          break;
        }
      }

      turn.end();

      return { error: state.error, saved: await blok.save() };
    }, { seed: c.seed, batches: c.batches });

    expect(run.error === null ? 'ok' : { errorCode: run.error }).toEqual(expectationFor(c, 'editor'));

    // A runner that refuses where json succeeds has no golden to match.
    const hasGolden = run.error === null && expectationFor(c, 'json') === 'ok';
    const actual = hasGolden ? stableStringify(normalizeForParity(run.saved, callerChosenIds(c))) : null;
    const golden = hasGolden ? stableStringify(goldenDocument(c.name)) : null;

    expect(actual).toBe(golden);
  });
}
