// src/tools/callout/types.ts

import type { BlockToolData } from '../../../types';

export interface CalloutData extends BlockToolData {
  emoji: string;
  textColor: string | null;
  backgroundColor: string | null;
}

export interface CalloutConfig {
  /**
   * Custom emoji picker handler.
   * When provided, replaces the built-in emoji picker.
   * Call `onSelect` with the chosen emoji character, or "" to clear.
   */
  emojiPicker?: (onSelect: (emoji: string) => void) => void;
}
