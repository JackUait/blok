import { IconCopy, IconDownload, IconImage } from '../../components/icons';
import { panelRow, panelSeparator, panelSwitch, type PanelPage } from './database-panel';

export interface ChartExportActions {
  t: (key: string) => string;
  copy: (background: boolean) => void;
  download: (format: 'png' | 'svg', background: boolean) => void;
}

/**
 * Notion's "Save chart as…" (notion.com/help/charts): a background choice, then
 * Copy as PNG, Download PNG or Download SVG. The choice is never saved, so each
 * opening starts with the background on.
 */
export const chartExportPage = ({ t, copy, download }: ChartExportActions): PanelPage => {
  const choice = { background: true };

  return {
    title: t('chartSaveAs'),
    returnFocus: 'database-settings-chart-save',
    build: (panel) => [
      panelSwitch({
        label: t('chartBackground'),
        testId: 'database-settings-chart-background',
        checked: choice.background,
        onToggle: (next) => {
          choice.background = next;
        },
      }),
      panelSeparator(),
      panelRow({
        label: t('chartCopyPng'),
        testId: 'database-settings-chart-copy',
        icon: IconCopy,
        onClick: () => {
          panel.close();
          copy(choice.background);
        },
      }),
      panelRow({
        label: t('chartDownloadPng'),
        testId: 'database-settings-chart-png',
        icon: IconImage,
        onClick: () => {
          panel.close();
          download('png', choice.background);
        },
      }),
      panelRow({
        label: t('chartDownloadSvg'),
        testId: 'database-settings-chart-svg',
        icon: IconDownload,
        onClick: () => {
          panel.close();
          download('svg', choice.background);
        },
      }),
    ],
  };
};
