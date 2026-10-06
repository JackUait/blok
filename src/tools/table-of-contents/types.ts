import type { BlockToolData } from '../../../types';
import type { BlockColorData } from '../../components/shared/block-color';

/**
 * Table of contents block data. Only the block's colour is stored: the
 * heading list is read from the page every time, never saved.
 */
export interface TableOfContentsData extends BlockToolData, BlockColorData {}
