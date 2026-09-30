import { createPreview, h } from '../../components/utils/block-preview';
import { IconDownload, IconFile } from '../../components/icons';

const glyph = (part: string, svg: string): HTMLElement => {
  const el = h('span', { 'data-part': part, 'aria-hidden': 'true' });

  el.innerHTML = svg;

  return el;
};

/** Blok's file card (tinted PDF tile, name, size, download button) inside a short note. */
export const renderFilePreview = (): HTMLElement => createPreview(
  'file',
  h('p', { 'data-part': 'lead' }, 'Slides from Friday’s review:'),
  h(
    'div',
    { 'data-part': 'card' },
    glyph('tile', IconFile),
    h(
      'div',
      { 'data-part': 'meta' },
      h('span', { 'data-part': 'name' }, 'Roadmap.pdf'),
      h('span', { 'data-part': 'size' }, '2.4 MB')
    ),
    glyph('download', IconDownload)
  ),
  h('p', { 'data-part': 'after' }, 'Feedback by Monday, please.')
);
