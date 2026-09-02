// docs/src/hooks/useServerTranslations.ts
import { useMemo } from 'react';
import { useI18n } from '../contexts/I18nContext';
import {
  serverCoverageNote,
  serverLimits,
  serverPaths,
} from '../components/server/server-data';
import type {
  ServerCodeSample,
  ServerLimit,
  ServerPath,
} from '../components/server/server-data';

/**
 * The /server page's prose lives in a data module, so until this overlay existed
 * the Russian page rendered ~90 chunks of English body copy — enough for Google
 * to classify /ru/server as an English page. Same shape as
 * `useToolsTranslations`: keys derived from the data's own ids, English literal
 * as the fallback so a missing key degrades instead of printing the key.
 */
export const useServerTranslations = () => {
  const { t, locale } = useI18n();

  const translateOr = (key: string, fallback: string): string => {
    const translated = t(key);
    return translated !== key ? translated : fallback;
  };

  const value = useMemo(() => {
    const sample = (key: string, item: ServerCodeSample): ServerCodeSample => ({
      ...item,
      label: translateOr(`${key}.label`, item.label),
    });

    const paths: ServerPath[] = serverPaths.map((path) => {
      const base = `server.paths.${path.id}`;
      return {
        ...path,
        title: translateOr(`${base}.title`, path.title),
        situation: translateOr(`${base}.situation`, path.situation),
        description: translateOr(`${base}.description`, path.description),
        whatToRun: path.whatToRun.map((item, i) => sample(`${base}.whatToRun.${i}`, item)),
        appRoute: path.appRoute.map((item, i) => sample(`${base}.appRoute.${i}`, item)),
        editorConfig: sample(`${base}.editorConfig`, path.editorConfig),
        failureModes: path.failureModes.map((mode, i) => ({
          symptom: translateOr(`${base}.failureModes.${i}.symptom`, mode.symptom),
          cause: translateOr(`${base}.failureModes.${i}.cause`, mode.cause),
          fix: translateOr(`${base}.failureModes.${i}.fix`, mode.fix),
        })),
      };
    });

    const limits: ServerLimit[] = serverLimits.map((limit) => ({
      ...limit,
      title: translateOr(`server.limits.${limit.id}.title`, limit.title),
      body: translateOr(`server.limits.${limit.id}.body`, limit.body),
    }));

    return {
      coverageNote: translateOr('server.coverageNote', serverCoverageNote),
      paths,
      limits,
    };
  }, [t, locale]);

  return value;
};
