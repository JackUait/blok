import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTabbables } from '../../../../src/components/utils/modal-dialog';

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('getTabbables hidden ancestors', () => {
  it.each(['hidden', 'aria-hidden="true"'])(
    'excludes descendants of a %s ancestor while retaining visible siblings in DOM order',
    (attribute) => {
      const container = document.createElement('div');

      container.innerHTML = `
        <input id="search">
        <nav ${attribute}>
          <button id="hidden-direct">Smileys</button>
          <div aria-hidden="false">
            <button id="hidden-nested" aria-hidden="false">Flags</button>
          </div>
        </nav>
        <div aria-hidden="false">
          <button id="visible">Close</button>
        </div>
      `;

      expect(getTabbables(container).map((element) => element.id)).toEqual(['search', 'visible']);
    }
  );

  it.each(['hidden', 'aria-hidden="true"'])(
    'still excludes an element with its own %s attribute',
    (attribute) => {
      const container = document.createElement('div');

      container.innerHTML = `
        <button id="hidden" ${attribute}>Hidden</button>
        <button id="visible" aria-hidden="false">Visible</button>
      `;

      expect(getTabbables(container).map((element) => element.id)).toEqual(['visible']);
    }
  );
});
