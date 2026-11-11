import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { syncAnnotationFocus } from '../../../../src/components/utils/annotation-focus';

const build = (html: string): HTMLElement => {
  const root = document.createElement('div');

  root.innerHTML = html;

  return root;
};

describe('syncAnnotationFocus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('makes every hint a focusable button in read-only mode', () => {
    const root = build('a <span data-blok-annotation="One">x</span> <b><span data-blok-annotation="Two">y</span></b>');

    syncAnnotationFocus(root, true);

    const hints = Array.from(root.querySelectorAll('span'));

    expect(hints.map(hint => hint.getAttribute('tabindex'))).toEqual([ '0', '0' ]);
    expect(hints.map(hint => hint.getAttribute('role'))).toEqual([ 'button', 'button' ]);
  });

  it('takes a hint out of the tab order in edit mode', () => {
    const root = build('<span data-blok-annotation="One" tabindex="0" role="button">x</span>');

    syncAnnotationFocus(root, false);

    const hint = root.querySelector('span');

    expect(hint?.hasAttribute('tabindex')).toBe(false);
    expect(hint?.hasAttribute('role')).toBe(false);
  });

  it('writes nothing in edit mode when there is nothing to remove', () => {
    const root = build('<span data-blok-annotation="One">x</span>');
    const records: MutationRecord[] = [];
    const observer = new MutationObserver(list => records.push(...list));

    observer.observe(root, { attributes: true, subtree: true });
    syncAnnotationFocus(root, false);
    records.push(...observer.takeRecords());
    observer.disconnect();

    expect(records).toHaveLength(0);
  });

  it('leaves other spans alone', () => {
    const root = build('<span data-latex="x">x</span><span>plain</span>');

    syncAnnotationFocus(root, true);

    expect(root.querySelector('[tabindex]')).toBeNull();
  });
});
