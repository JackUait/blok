// docs/src/hooks/usePresetsTranslations.ts
import { useMemo } from 'react';
import { useI18n } from '../contexts/I18nContext';
import { presets } from '../components/presets/presets-data';
import type { PresetSection } from '../components/presets/presets-data';

/** See `useToolsTranslations`: same overlay shape, keyed off the preset ids. */
export const usePresetsTranslations = (): PresetSection[] => {
  const { t, locale } = useI18n();

  const translateOr = (key: string, fallback: string): string => {
    const translated = t(key);
    return translated !== key ? translated : fallback;
  };

  return useMemo(
    () =>
      presets.map((preset) => {
        const base = `presets.items.${preset.id}`;
        return {
          ...preset,
          title: translateOr(`${base}.title`, preset.title),
          description: translateOr(`${base}.description`, preset.description),
          uploadByUrlNote: translateOr(`${base}.uploadByUrlNote`, preset.uploadByUrlNote),
          productionNote:
            preset.productionNote === undefined
              ? undefined
              : translateOr(`${base}.productionNote`, preset.productionNote),
          configOptions: preset.configOptions.map((option) => ({
            ...option,
            description: translateOr(
              `${base}.configOptions.${option.option}.description`,
              option.description,
            ),
          })),
          storageSetup: preset.storageSetup.map((step, i) =>
            translateOr(`${base}.storageSetup.${i}`, step),
          ),
        };
      }),
    [t, locale],
  );
};
