import type { I18n } from '../../../types/api';
import { twMerge } from '../../components/utils/tw';
import { COLOR_PRESETS } from '../../components/shared/color-presets';

export type CellColorMode = 'textColor' | 'backgroundColor';

interface CellColorPickerOptions {
  i18n: I18n;
  onColorSelect: (color: string | null, mode: CellColorMode) => void;
}

interface CellColorPickerResult {
  element: HTMLDivElement;
}

/**
 * Creates a cell color picker with Text/Background tabs, 9 swatches, and a "Default" reset button.
 * Used in the table cell popover to let users pick a cell text or background color.
 */
export const createCellColorPicker = (options: CellColorPickerOptions): CellColorPickerResult => {
  const { i18n, onColorSelect } = options;

  let currentMode: CellColorMode = 'backgroundColor';

  const wrapper = document.createElement('div');

  wrapper.setAttribute('data-blok-testid', 'cell-color-picker');
  wrapper.className = 'flex flex-col gap-2 p-2';

  // ─── Tabs ──────────────────────────────────────────────
  const tabRow = document.createElement('div');

  tabRow.className = 'flex gap-1';

  const modes: Array<{ mode: CellColorMode; labelKey: string }> = [
    { mode: 'textColor', labelKey: 'tools.marker.textColor' },
    { mode: 'backgroundColor', labelKey: 'tools.marker.background' },
  ];

  const tabs: HTMLButtonElement[] = [];

  for (const { mode, labelKey } of modes) {
    const tab = document.createElement('button');

    tab.setAttribute('data-blok-testid', `cell-color-tab-${mode}`);
    tab.className = twMerge(
      'flex-1 py-1 text-xs text-center rounded-md cursor-pointer',
      'border-none transition-colors'
    );
    tab.textContent = i18n.t(labelKey);
    tab.addEventListener('click', () => {
      currentMode = mode;
      updateActiveTab();
      renderSwatches();
    });
    tabs.push(tab);
    tabRow.appendChild(tab);
  }

  const updateActiveTab = (): void => {
    for (const tab of tabs) {
      const tabMode = tab.getAttribute('data-blok-testid')?.replace('cell-color-tab-', '') as CellColorMode;

      if (tabMode === currentMode) {
        tab.setAttribute('data-blok-active', '');
        tab.classList.add('bg-item-hover-bg');
      } else {
        tab.removeAttribute('data-blok-active');
        tab.classList.remove('bg-item-hover-bg');
      }
    }
  };

  // ─── Swatches ──────────────────────────────────────────
  const grid = document.createElement('div');

  grid.className = 'grid grid-cols-5 gap-1.5';

  const renderSwatches = (): void => {
    grid.innerHTML = '';

    for (const preset of COLOR_PRESETS) {
      const swatch = document.createElement('button');

      swatch.setAttribute('data-blok-testid', `cell-color-swatch-${preset.name}`);

      if (currentMode === 'backgroundColor') {
        swatch.className = twMerge(
          'w-8 h-8 rounded-md cursor-pointer border-none',
          'transition-shadow ring-inset hover:ring-2 hover:ring-black/10'
        );
        swatch.style.backgroundColor = preset.bg;
      } else {
        swatch.className = twMerge(
          'w-8 h-8 rounded-md cursor-pointer border-none',
          'transition-shadow ring-inset hover:ring-2 hover:ring-black/10',
          'flex items-center justify-center text-sm font-semibold bg-transparent'
        );
        swatch.style.color = preset.text;
        swatch.textContent = 'A';
      }

      swatch.addEventListener('click', () => {
        const color = currentMode === 'backgroundColor' ? preset.bg : preset.text;

        onColorSelect(color, currentMode);
      });
      grid.appendChild(swatch);
    }
  };

  // ─── Default button ────────────────────────────────────
  const defaultBtn = document.createElement('button');

  defaultBtn.setAttribute('data-blok-testid', 'cell-color-default-btn');
  defaultBtn.className = twMerge(
    'w-full py-1.5 text-xs text-center rounded-md cursor-pointer',
    'bg-transparent border-none hover:bg-item-hover-bg',
    'mt-0.5 transition-colors'
  );
  defaultBtn.textContent = i18n.t('tools.marker.default');
  defaultBtn.addEventListener('click', () => {
    onColorSelect(null, currentMode);
  });

  // ─── Assemble ──────────────────────────────────────────
  updateActiveTab();
  renderSwatches();

  wrapper.appendChild(tabRow);
  wrapper.appendChild(grid);
  wrapper.appendChild(defaultBtn);

  return { element: wrapper };
};
