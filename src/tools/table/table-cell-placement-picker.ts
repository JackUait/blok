import type { I18n } from '../../../types/api';
import type { CellPlacement } from './types';

interface PlacementPickerOptions {
  i18n: I18n;
  currentPlacement: CellPlacement | undefined;
  onPlacementSelect: (placement: CellPlacement) => void;
}

interface PlacementPickerResult {
  element: HTMLDivElement;
}

const PLACEMENTS: CellPlacement[] = [
  'top-left', 'top-center', 'top-right',
  'middle-left', 'middle-center', 'middle-right',
  'bottom-left', 'bottom-center', 'bottom-right',
];

const I18N_KEYS: Record<CellPlacement, string> = {
  'top-left': 'tools.table.placementTopLeft',
  'top-center': 'tools.table.placementTopCenter',
  'top-right': 'tools.table.placementTopRight',
  'middle-left': 'tools.table.placementMiddleLeft',
  'middle-center': 'tools.table.placementMiddleCenter',
  'middle-right': 'tools.table.placementMiddleRight',
  'bottom-left': 'tools.table.placementBottomLeft',
  'bottom-center': 'tools.table.placementBottomCenter',
  'bottom-right': 'tools.table.placementBottomRight',
};

const V_ALIGN: Record<string, string> = {
  top: 'flex-start',
  middle: 'center',
  bottom: 'flex-end',
};

const H_ALIGN: Record<string, string> = {
  left: 'flex-start',
  center: 'center',
  right: 'flex-end',
};

export const createCellPlacementPicker = (options: PlacementPickerOptions): PlacementPickerResult => {
  const current = options.currentPlacement ?? 'top-left';
  const wrapper = document.createElement('div');

  wrapper.style.padding = '8px';

  const grid = document.createElement('div');

  grid.style.display = 'grid';
  grid.style.gridTemplateColumns = 'repeat(3, 1fr)';
  grid.style.gap = '3px';

  const label = document.createElement('div');

  label.style.textAlign = 'center';
  label.style.fontSize = '11px';
  label.style.marginTop = '6px';
  label.style.opacity = '0.6';
  label.textContent = options.i18n.t(I18N_KEYS[current]);

  for (const placement of PLACEMENTS) {
    const [vKey, hKey] = placement.split('-');
    const cell = document.createElement('div');

    cell.setAttribute('data-placement', placement);
    cell.style.width = '32px';
    cell.style.height = '26px';
    cell.style.borderRadius = '3px';
    cell.style.display = 'flex';
    cell.style.flexDirection = 'column';
    cell.style.alignItems = H_ALIGN[hKey];
    cell.style.justifyContent = V_ALIGN[vKey];
    cell.style.padding = '3px';
    cell.style.cursor = 'pointer';
    cell.style.gap = '1px';

    if (placement === current) {
      cell.setAttribute('data-active', 'true');
      cell.style.outline = '2px solid var(--blok-color-primary, #388AE5)';
      cell.style.outlineOffset = '-2px';
      cell.style.backgroundColor = 'var(--blok-bg-secondary, rgba(56, 138, 229, 0.1))';
    } else {
      cell.style.backgroundColor = 'var(--blok-bg-tertiary, #f0f0f0)';
    }

    const line1 = document.createElement('div');

    line1.style.width = '14px';
    line1.style.height = '2px';
    line1.style.borderRadius = '1px';
    line1.style.backgroundColor = 'currentColor';
    line1.style.opacity = '0.6';

    const line2 = document.createElement('div');

    line2.style.width = '9px';
    line2.style.height = '2px';
    line2.style.borderRadius = '1px';
    line2.style.backgroundColor = 'currentColor';
    line2.style.opacity = '0.3';

    cell.appendChild(line1);
    cell.appendChild(line2);

    cell.addEventListener('click', () => {
      grid.querySelectorAll('[data-placement]').forEach(el => {
        const element = el as HTMLElement;
        element.removeAttribute('data-active');
        element.style.outline = '';
        element.style.outlineOffset = '';
        element.style.backgroundColor = 'var(--blok-bg-tertiary, #f0f0f0)';
      });

      cell.setAttribute('data-active', 'true');
      cell.style.outline = '2px solid var(--blok-color-primary, #388AE5)';
      cell.style.outlineOffset = '-2px';
      cell.style.backgroundColor = 'var(--blok-bg-secondary, rgba(56, 138, 229, 0.1))';
      label.textContent = options.i18n.t(I18N_KEYS[placement]);

      options.onPlacementSelect(placement);
    });

    grid.appendChild(cell);
  }

  wrapper.appendChild(grid);
  wrapper.appendChild(label);

  return { element: wrapper };
};
