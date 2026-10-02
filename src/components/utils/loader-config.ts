import type { BlokConfig } from '../../../types';

export type SkeletonRow = 'heading' | 'paragraph' | 'list';

export interface ResolvedLoaderConfig {
  enabled: boolean;
  skeleton: SkeletonRow[];
  delay: number;
}

export const DEFAULT_SKELETON: SkeletonRow[] = ['heading', 'paragraph', 'paragraph', 'paragraph', 'list', 'list'];
export const DEFAULT_LOADER_DELAY = 150;

const ROWS = new Set<string>(['heading', 'paragraph', 'list']);

export const resolveLoaderConfig = (input: BlokConfig['loader']): ResolvedLoaderConfig => {
  if (input === false) {
    return { enabled: false, skeleton: [...DEFAULT_SKELETON], delay: DEFAULT_LOADER_DELAY };
  }

  const options = typeof input === 'object' && input !== null ? input : {};
  // A plain-JS host can pass anything here.
  const rows = Array.isArray(options.skeleton) ? options.skeleton.filter((row): row is SkeletonRow => ROWS.has(row)) : [];
  const delay = options.delay;

  return {
    enabled: true,
    skeleton: rows.length > 0 ? rows : [...DEFAULT_SKELETON],
    delay: typeof delay === 'number' && Number.isFinite(delay) && delay >= 0 ? delay : DEFAULT_LOADER_DELAY,
  };
};
