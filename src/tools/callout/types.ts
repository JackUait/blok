// src/tools/callout/types.ts

import type { BlockToolData } from '../../../types';

export interface CalloutData extends BlockToolData {
  emoji: string;
  textColor: string | null;
  backgroundColor: string | null;
}

export interface CalloutConfig {}
