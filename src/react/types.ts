import type { BlokConfig, Blok } from '@/types';

/**
 * Configuration for useBlok hook.
 * Same as BlokConfig but without `holder` — the holder is managed by BlokContent.
 */
export interface UseBlokConfig extends Omit<BlokConfig, 'holder'> {}

/**
 * Props for the BlokContent component.
 * Extends standard div HTML attributes so className, style, id, etc. pass through.
 */
export interface BlokContentProps extends React.HTMLAttributes<HTMLDivElement> {
  /** The Blok editor instance returned by useBlok. Pass null if editor is not ready yet. */
  editor: Blok | null;
}
