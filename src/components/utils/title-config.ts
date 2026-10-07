import type { BlokConfig, TitleConfig } from '../../../types';

export interface ResolvedTitleConfig {
  holder: HTMLElement | string | null;
  /** Null: use the `title.placeholder` message. */
  placeholder: string | null;
  icon: boolean;
  onChange: NonNullable<TitleConfig['onChange']> | null;
  onIconChange: NonNullable<TitleConfig['onIconChange']> | null;
}

export const normalizeTitleConfig = (value: BlokConfig['pageTitle']): ResolvedTitleConfig | null => {
  if (value === undefined || value === false) {
    return null;
  }
  const config: TitleConfig = value === true ? {} : value;

  return {
    holder: config.holder ?? null,
    placeholder: config.placeholder === undefined || config.placeholder === '' ? null : config.placeholder,
    icon: config.icon !== false,
    onChange: config.onChange ?? null,
    onIconChange: config.onIconChange ?? null,
  };
};
