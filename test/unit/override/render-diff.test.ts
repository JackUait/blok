import { describe, expect, it } from 'vitest';

import { panelsEqual, captureEphemeral, restoreEphemeral } from '../../../override-extension/lib/render-diff.mjs';

const build = (html: string): HTMLElement => {
  const root = document.createElement('div');
  root.innerHTML = html;
  return root;
};

describe('panelsEqual', () => {
  it('is true for identical markup', () => {
    const a = build('<section class="card"><p>Your build</p></section>');
    const b = build('<section class="card"><p>Your build</p></section>');
    expect(panelsEqual(a, b)).toBe(true);
  });

  it('is false when text or structure differs', () => {
    const a = build('<section><p>Still on Blok 1.8.0</p></section>');
    const b = build('<section><p>Running your build</p></section>');
    expect(panelsEqual(a, b)).toBe(false);
  });

  it('ignores a details open attribute the user toggled', () => {
    const a = build('<details data-key="swap" open><summary>Swap</summary></details>');
    const b = build('<details data-key="swap"><summary>Swap</summary></details>');
    expect(panelsEqual(a, b)).toBe(true);
  });

  it('ignores a select value the user picked (property, not attribute)', () => {
    const a = build('<select id="v"><option value="1">1</option><option value="2">2</option></select>');
    const b = build('<select id="v"><option value="1">1</option><option value="2">2</option></select>');
    (a.querySelector('select') as HTMLSelectElement).value = '2';
    expect(panelsEqual(a, b)).toBe(true);
  });

  it('does not mutate the compared trees', () => {
    const a = build('<details data-key="swap" open><summary>Swap</summary></details>');
    const b = build('<details data-key="swap"><summary>Swap</summary></details>');
    panelsEqual(a, b);
    expect(a.querySelector('details')?.hasAttribute('open')).toBe(true);
  });
});

describe('captureEphemeral / restoreEphemeral', () => {
  it('carries open details across a replace by data-key', () => {
    const before = build('<details data-key="swap" open><summary>Swap</summary></details><details data-key="help"><summary>Help</summary></details>');
    const snapshot = captureEphemeral(before);
    const after = build('<details data-key="swap"><summary>Swap</summary></details><details data-key="help"><summary>Help</summary></details>');
    restoreEphemeral(after, snapshot);
    expect(after.querySelector<HTMLDetailsElement>('[data-key="swap"]')?.open).toBe(true);
    expect(after.querySelector<HTMLDetailsElement>('[data-key="help"]')?.open).toBe(false);
  });

  it('carries a select value across a replace by id', () => {
    const before = build('<select id="v"><option value="1">1</option><option value="2">2</option></select>');
    (before.querySelector('select') as HTMLSelectElement).value = '2';
    const snapshot = captureEphemeral(before);
    const after = build('<select id="v"><option value="1">1</option><option value="2">2</option></select>');
    restoreEphemeral(after, snapshot);
    expect(after.querySelector<HTMLSelectElement>('select')?.value).toBe('2');
  });

  it('restores focus to the matching control by accessible name', () => {
    const before = build('<button aria-label="Use your build on https://kb.example">switch</button>');
    document.body.appendChild(before);
    before.querySelector('button')?.focus();
    const snapshot = captureEphemeral(before);
    const after = build('<button aria-label="Use your build on https://kb.example">switch</button>');
    before.replaceWith(after);
    restoreEphemeral(after, snapshot);
    expect(after.querySelector('button')).toHaveFocus();
    after.remove();
  });

  it('is a no-op when the remembered elements are gone', () => {
    const before = build('<details data-key="swap" open><summary>Swap</summary></details><select id="v"><option value="1">1</option></select>');
    const snapshot = captureEphemeral(before);
    const after = build('<p>nothing to restore into</p>');
    expect(() => restoreEphemeral(after, snapshot)).not.toThrow();
  });
});
