import type { I18n } from '../../../types/api';
import { createColorPicker } from '../../components/shared/color-picker';

export type CellColorMode = 'textColor' | 'backgroundColor';

interface CellColorPickerOptions {
  i18n: I18n;
  onColorSelect: (color: string | null, mode: CellColorMode) => void;
}

interface CellColorPickerResult {
  element: HTMLDivElement;
}

/**
 * Creates a cell color picker for the table cell popover.
 * Thin wrapper around the shared color picker component.
 */
export const createCellColorPicker = (options: CellColorPickerOptions): CellColorPickerResult => {
  const element = createColorPicker({
    i18n: options.i18n,
    testIdPrefix: 'cell-color',
    defaultModeIndex: 1,
    modes: [
      { key: 'textColor', labelKey: 'tools.marker.textColor', presetField: 'text' },
      { key: 'backgroundColor', labelKey: 'tools.marker.background', presetField: 'bg' },
    ],
    onColorSelect: (color, modeKey) => {
      options.onColorSelect(color, modeKey as CellColorMode);
    },
  });

  return { element };
};
