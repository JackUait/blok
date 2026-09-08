import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, getByRole } from '@testing-library/dom';
import { renderIconGallery } from '../../../src/playground/icon-gallery';
import { IconColumns, IconDownload } from '../../../src/components/icons';

// No exported icon carries a non-20 intrinsic size any more, so the native-size
// restore needs a fixture to have anything to restore to.
const IconFixtureSmall = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true" focusable="false"><path d="M3 7h8" stroke="currentColor" stroke-width="1"/></svg>';

describe('icon gallery working sizes', () => {
  let container: HTMLElement;

  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement('div');
    document.body.appendChild(container);
    renderIconGallery({
      container,
      iconGroups: { Sample: ['IconColumns', 'IconFixtureSmall', 'IconDownload'] },
      icons: { IconColumns, IconFixtureSmall, IconDownload },
    });
  });

  afterEach(() => {
    container.remove();
    vi.restoreAllMocks();
  });

  it('compares every icon at the selected size without changing source SVG strings', () => {
    const controls = getByRole(container, 'group', { name: 'Icon preview size' });

    for (const size of [16, 20, 24]) {
      const button = getByRole(controls, 'button', { name: `${size} px` });

      fireEvent.click(button);

      // eslint-disable-next-line testing-library/no-node-access -- SVG dimensions have no accessible role query.
      for (const svg of container.querySelectorAll('svg')) {
        expect(svg.getAttribute('width')).toBe(String(size));
        expect(svg.getAttribute('height')).toBe(String(size));
      }

      expect(getByRole(controls, 'button', { pressed: true })).toBe(button);
    }

    expect(new DOMParser().parseFromString(IconFixtureSmall, 'image/svg+xml').documentElement.getAttribute('width')).toBe('14');
  });

  it('restores intrinsic sizes after a uniform comparison', () => {
    fireEvent.click(getByRole(container, 'button', { name: '24 px' }));
    fireEvent.click(getByRole(container, 'button', { name: 'Native' }));

    // eslint-disable-next-line testing-library/no-node-access -- SVG dimensions have no accessible role query.
    const sizes = Array.from(container.querySelectorAll('svg')).map(svg => svg.getAttribute('width'));

    expect(sizes).toEqual(['20', '14', '20']);
  });
});
