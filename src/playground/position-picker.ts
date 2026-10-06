/**
 * A tiny screen with one spot per notification position. It is a view over
 * the real <select>: clicks write through it, and it redraws on its change.
 */

const ROWS = ['top', 'bottom'];
const COLUMNS = ['left', 'center', 'right'];

const MOVES: Record<string, [row: number, column: number]> = {
  ArrowUp: [-1, 0],
  ArrowDown: [1, 0],
  ArrowLeft: [0, -1],
  ArrowRight: [0, 1],
};

const clamp = (value: number, max: number): number => Math.min(Math.max(value, 0), max);

export const mountPositionPicker = (select: HTMLSelectElement, host: HTMLElement): void => {
  const group = document.createElement('div');

  group.className = 'position-picker';
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-label', 'Notification position');

  const radios = new Map<string, HTMLButtonElement>();

  for (const option of Array.from(select.options)) {
    const spot = document.createElement('button');

    spot.type = 'button';
    spot.className = 'position-picker__spot';
    spot.setAttribute('role', 'radio');
    spot.setAttribute('data-position', option.value);
    spot.setAttribute('aria-label', option.text);
    radios.set(option.value, spot);
    group.append(spot);
  }

  const redraw = (): void => {
    radios.forEach((spot, value) => {
      const isChecked = value === select.value;

      spot.setAttribute('aria-checked', String(isChecked));
      spot.setAttribute('tabindex', isChecked ? '0' : '-1');
    });
  };

  const choose = (value: string): void => {
    if (value === select.value) {
      return;
    }
    // The playground rebuilds the editor on the select's change event.
    Object.assign(select, { value });
    select.dispatchEvent(new Event('change', { bubbles: true }));
  };

  group.addEventListener('click', (event) => {
    const spot = (event.target as Element).closest<HTMLElement>('[role="radio"]');
    const value = spot?.getAttribute('data-position');

    if (value) {
      choose(value);
    }
  });

  group.addEventListener('keydown', (event) => {
    const move = MOVES[event.key];
    const [row, column] = select.value.split('-');

    if (!move || row === undefined || column === undefined) {
      return;
    }
    event.preventDefault();

    const nextRow = ROWS[clamp(ROWS.indexOf(row) + move[0], ROWS.length - 1)];
    const nextColumn = COLUMNS[clamp(COLUMNS.indexOf(column) + move[1], COLUMNS.length - 1)];
    const next = `${nextRow}-${nextColumn}`;

    if (radios.has(next)) {
      choose(next);
      radios.get(next)?.focus();
    }
  });

  select.addEventListener('change', redraw);
  redraw();
  host.append(group);
};
