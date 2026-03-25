// src/tools/callout/types.ts

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

export interface CalloutData {
  text: string;
  emoji: string;
  color: CalloutColor;
}

export interface CalloutConfig {
  placeholder?: string;
}
