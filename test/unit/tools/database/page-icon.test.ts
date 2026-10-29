import { describe, expect, it } from 'vitest';
import { IconPageEmpty } from '../../../../src/components/icons';
import { fileChipIcon, pagePlaceholderIcon } from '../../../../src/tools/database/page-icon';

const pathData = (root: ParentNode): Array<string | null> =>
  [...root.querySelectorAll('path')].map((path) => path.getAttribute('d'));

const emptyPage = (): Array<string | null> => {
  const holder = document.createElement('span');

  holder.innerHTML = IconPageEmpty;

  return pathData(holder);
};

/** notion-spec-2 §18.1, §19.15, §19.17: titles, relation rows and file chips use `pageEmpty`. */
describe('page glyphs', () => {
  it('a title with no icon shows the empty page', () => {
    expect(pathData(pagePlaceholderIcon())).toEqual(emptyPage());
  });

  it('a file chip shows the empty page', () => {
    expect(pathData(fileChipIcon())).toEqual(emptyPage());
  });
});
