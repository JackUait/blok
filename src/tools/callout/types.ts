// src/tools/callout/types.ts

import type { BlockToolData } from '../../../types';

export type CalloutColor =
  | 'default'
  | 'gray'
  | 'brown'
  | 'orange'
  | 'yellow'
  | 'green'
  | 'teal'
  | 'blue'
  | 'purple'
  | 'pink'
  | 'red';

export interface CalloutData extends BlockToolData {
  emoji: string;
  color: CalloutColor;
}

export interface CalloutConfig {}
