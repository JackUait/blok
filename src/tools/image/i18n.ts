import type { I18nInstance } from '../../components/utils/tools';
import { englishDictionary } from '../../components/i18n/lightweight-i18n';

export function tr(i18n: I18nInstance | undefined, key: string): string {
  if (i18n?.has(key)) return i18n.t(key);

  return (englishDictionary as Record<string, string>)[key] ?? key;
}
