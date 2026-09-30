import { createPreview, h } from '../../components/utils/block-preview';

import { DEFAULT_EMOJI } from './constants';

/** Callout: Blok's default emoji on a tinted panel. */
export const renderCalloutPreview = (): HTMLElement =>
  createPreview(
    'callout',
    h('p', { 'data-lead': '' }, 'Before you start:'),
    h(
      'div',
      { 'data-panel': '' },
      h('span', { 'data-emoji': '' }, DEFAULT_EMOJI),
      h(
        'span',
        { 'data-text': '' },
        'Type ',
        h('kbd', {}, '/'),
        ' anywhere to add a block. Tables, toggles, even videos.'
      )
    ),
    h('p', { 'data-after': '' }, 'Now go make something lovely.')
  );
