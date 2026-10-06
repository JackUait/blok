import { DATA_ATTR } from '../constants/data-attributes';
import type { SkeletonRow } from './loader-config';

/** Uneven on purpose: equal bars read as a progress meter, not as text. */
const PARAGRAPH_WIDTHS = ['94%', '88%', '62%', '97%', '76%'];
const LIST_WIDTHS = ['46%', '58%', '38%'];

const barWidth = (row: SkeletonRow, n: number): string => {
  if (row === 'heading') {
    return '42%';
  }

  const widths = row === 'list' ? LIST_WIDTHS : PARAGRAPH_WIDTHS;

  return widths[n % widths.length];
};

export const buildLoadingSkeleton = (rows: SkeletonRow[]): { root: HTMLElement; bars: HTMLElement[] } => {
  const root = document.createElement('div');

  root.setAttribute(DATA_ATTR.loadingSkeleton, '');
  root.setAttribute('data-blok-testid', 'loading-skeleton');
  root.setAttribute('aria-hidden', 'true');
  root.setAttribute('inert', '');

  const counts = { heading: 0, paragraph: 0, list: 0 };

  const bars = rows.map((row, index) => {
    const bar = document.createElement('div');
    const width = barWidth(row, counts[row]++);

    bar.setAttribute(DATA_ATTR.skeletonBar, row);
    bar.style.setProperty('--blok-skeleton-width', width);
    bar.style.setProperty('--blok-skeleton-index', String(index));

    if (row === 'list') {
      const bullet = document.createElement('span');

      bullet.setAttribute('data-blok-skeleton-bullet', '');
      bar.appendChild(bullet);
    }

    root.appendChild(bar);

    return bar;
  });

  return { root, bars };
};
