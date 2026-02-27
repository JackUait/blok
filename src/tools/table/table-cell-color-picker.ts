import type { I18n } from '../../../types/api';
import { twMerge } from '../../components/utils/tw';
import { COLOR_PRESETS } from '../../components/shared/color-presets';

interface CellColorPickerOptions {
  i18n: I18n;
  onColorSelect: (color: string | null) => void;
}

interface CellColorPickerResult {
  element: HTMLDivElement;
}

/**
 * Creates a cell color picker with 9 background-color swatches and a "Default" reset button.
 * Used in the table cell popover to let users pick a cell background color.
 */
export const createCellColorPicker = (options: CellColorPickerOptions): CellColorPickerResult => {
  const { i18n, onColorSelect } = options;

  const wrapper = document.createElement('div');

  wrapper.setAttribute('data-blok-testid', 'cell-color-picker');
  wrapper.className = 'flex flex-col gap-2 p-2';

  const grid = document.createElement('div');

  grid.className = 'grid grid-cols-5 gap-1.5';

  for (const preset of COLOR_PRESETS) {
    const swatch = document.createElement('button');

    swatch.setAttribute('data-blok-testid', `cell-color-swatch-${preset.name}`);
    swatch.className = twMerge(
      'w-8 h-8 rounded-md cursor-pointer border-none',
      'transition-shadow ring-inset hover:ring-2 hover:ring-black/10'
    );
    swatch.style.backgroundColor = preset.bg;
    swatch.addEventListener('click', () => {
      onColorSelect(preset.bg);
    });
    grid.appendChild(swatch);
  }

  const defaultBtn = document.createElement('button');

  defaultBtn.setAttribute('data-blok-testid', 'cell-color-default-btn');
  defaultBtn.className = twMerge(
    'w-full py-1.5 text-xs text-center rounded-md cursor-pointer',
    'bg-transparent border-none hover:bg-item-hover-bg',
    'mt-0.5 transition-colors'
  );
  defaultBtn.textContent = i18n.t('tools.marker.default');
  defaultBtn.addEventListener('click', () => {
    onColorSelect(null);
  });

  wrapper.appendChild(grid);
  wrapper.appendChild(defaultBtn);

  return { element: wrapper };
};
