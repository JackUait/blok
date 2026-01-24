export type ChangeCategory = 'added' | 'changed' | 'fixed' | 'deprecated' | 'removed' | 'security';

export type ReleaseType = 'major' | 'minor' | 'patch';

export interface Change {
  category: ChangeCategory;
  description: string;
  link?: string;
}

export interface Release {
  version: string;
  releaseType: ReleaseType;
  date: string;
  highlight?: string;
  releaseUrl?: string;
  changes: Change[];
}

export interface CategoryFilter {
  category: ChangeCategory | 'all';
  label: string;
  icon: string;
}
