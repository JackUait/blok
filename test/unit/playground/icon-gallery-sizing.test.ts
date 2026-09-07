import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, getByRole } from '@testing-library/dom';
import { renderIconGallery } from '../../../src/playground/icon-gallery';
import { IconColumns, IconDice, IconDownload } from '../../../src/components/icons';

describe('icon gallery working sizes', () => {
  let container: HTMLElement;

  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement('div');
    document.body.appendChild(container);
    renderIconGallery({
      container,
      iconGroups: { Sample: ['IconColumns', 'IconDice', 'IconDownload'] },
      icons: { IconColumns, IconDice, IconDownload },
    });
  });

  afterEach(() => {
    container.remove();
    vi.restoreAllMocks();
  });

  it('compares every icon at the selected size without changing source SVG strings', () => {
    const controls = getByRole(container, 'group', { name: 'Icon preview size' });

    for (const size of [16, 20, 24]) {
      const button = getByRole(controls, 'button', { name: `${size} px`, exact: true });

      fireEvent.click(button);

      // eslint-disable-next-line testing-library/no-node-access -- SVG dimensions have no accessible role query.
      for (const svg of container.querySelectorAll('svg')) {
        expect(svg.getAttribute('width')).toBe(String(size));
        expect(svg.getAttribute('height')).toBe(String(size));
      }

      expect(getByRole(controls, 'button', { pressed: true })).toBe(button);
    }

    expect(new DOMParser().parseFromString(IconDice, 'image/svg+xml').documentElement.getAttribute('width')).toBe('14');
  });

  it('restores intrinsic sizes after a uniform comparison', () => {
    fireEvent.click(getByRole(container, 'button', { name: '24 px', exact: true }));
    fireEvent.click(getByRole(container, 'button', { name: 'Native', exact: true }));

    // eslint-disable-next-line testing-library/no-node-access -- SVG dimensions have no accessible role query.
    const sizes = Array.from(container.querySelectorAll('svg')).map(svg => svg.getAttribute('width'));

    expect(sizes).toEqual(['20', '14', '20']);
  });
});
