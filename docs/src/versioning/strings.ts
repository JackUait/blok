// Not in en.json/ru.json: old tags get this folder copied in, and their
// translation files lack these keys.
export const VERSION_STRINGS = {
  en: {
    pickerLabel: 'Documentation version',
    next: 'Next',
    archive: (version: string) => `You're viewing docs for ${version}.`,
    unreleased: "You're viewing docs for an unreleased version.",
    toLatest: 'Go to the latest version',
  },
  ru: {
    pickerLabel: 'Версия документации',
    next: 'Следующая',
    archive: (version: string) => `Вы читаете документацию версии ${version}.`,
    unreleased: 'Вы читаете документацию невыпущенной версии.',
    toLatest: 'Перейти к последней версии',
  },
} as const;

export const stringsFor = (routerPath: string) =>
  routerPath === '/ru' || routerPath.startsWith('/ru/') ? VERSION_STRINGS.ru : VERSION_STRINGS.en;
