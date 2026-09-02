// docs/src/pages/ServerPage.tsx
import { Nav } from '../components/layout/Nav';
import { Footer } from '../components/layout/Footer';
import { Typo } from '../components/common/Typo';
import { ServerPathSection } from '../components/server/ServerPathSection';
import { useServerTranslations } from '../hooks/useServerTranslations';
import { NAV_LINKS } from '../utils/constants';
import { useI18n } from '../contexts/I18nContext';
import { getRouteMetadata } from '../seo/route-metadata';
import { localizedPath } from '../seo/locales';

const ENGLISH_H1 = 'Uploads and link previews';

/**
 * The deployment-paths page. Order is load-bearing: the coverage limit is stated
 * before anything is chosen, and the path that runs no service comes first —
 * an extra service to run is the single biggest reason someone installs nothing.
 */
export const ServerContent: React.FC = () => {
  const { locale, t } = useI18n();
  const { coverageNote, paths: serverPaths, limits: serverLimits } = useServerTranslations();
  // See PresetsContent: the descriptive H1 lives in route-metadata.ts, keyed off
  // the locale in the path, so a /ru/server reader gets the Russian heading
  // route-metadata.ru.ts already authors instead of a hardcoded English one.
  const heading = getRouteMetadata(localizedPath('/server', locale))?.h1 ?? ENGLISH_H1;

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-10 lg:py-14" data-blok-testid="server-docs">
      <div className="mb-10">
        <h1 className="text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">
          <Typo>{heading}</Typo>
        </h1>
        <p className="mt-3 max-w-2xl text-base leading-relaxed text-muted-foreground">
          <Typo>{t('server.intro')}</Typo>
        </p>
      </div>

      <div
        className="mb-12 rounded-2xl border border-border bg-secondary/40 p-5"
        data-blok-testid="server-coverage-note"
      >
        <p className="text-sm font-bold uppercase tracking-wide text-foreground">
          {t('server.coverageLabel')}
        </p>
        <p className="mt-2 text-base leading-relaxed text-muted-foreground">
          <Typo>{coverageNote}</Typo>
        </p>
      </div>

      <div className="mb-12 overflow-x-auto rounded-2xl border border-border bg-card shadow-sm">
        <table className="w-full border-collapse text-left text-sm" data-blok-testid="server-table">
          <thead>
            <tr className="border-b border-border bg-secondary/60">
              <th className="px-4 py-3 font-semibold text-foreground">{t('server.tablePath')}</th>
              <th className="px-4 py-3 font-semibold text-foreground">
                {t('server.tableAppRoute')}
              </th>
              <th className="px-4 py-3 font-semibold text-foreground">
                {t('server.tableRunsService')}
              </th>
            </tr>
          </thead>
          <tbody>
            {serverPaths.map((path) => (
              <tr
                key={path.id}
                className="border-b border-border last:border-0"
                data-blok-testid={`server-summary-${path.id}`}
              >
                <td className="px-4 py-3 align-top">
                  <a href={`#${path.id}`} className="font-semibold text-foreground hover:underline">
                    <Typo>{path.title}</Typo>
                  </a>
                </td>
                <td className="px-4 py-3 align-top text-muted-foreground">
                  {path.appRoute.length > 0 ? t('server.yes') : t('server.none')}
                </td>
                <td className="px-4 py-3 align-top text-muted-foreground">
                  {path.runsService ? t('server.yes') : t('server.no')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mb-14" data-blok-testid="server-limits">
        <h2 className="mb-4 text-2xl font-extrabold tracking-tight text-foreground">
          {t('server.limitsHeading')}
        </h2>
        <div className="flex flex-col gap-4">
          {serverLimits.map((limit) => (
            <div
              key={limit.id}
              className="rounded-2xl border border-border bg-card p-5 shadow-sm"
              data-blok-testid={`server-limit-${limit.id}`}
            >
              <p className="text-base font-bold text-foreground">
                <Typo>{limit.title}</Typo>
              </p>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                <Typo>{limit.body}</Typo>
              </p>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-16" data-blok-testid="server-paths">
        {serverPaths.map((path) => (
          <ServerPathSection key={path.id} section={path} />
        ))}
      </div>
    </div>
  );
};

export const ServerPage: React.FC = () => (
  <>
    <Nav links={NAV_LINKS} />
    <main className="min-h-screen bg-background pt-16">
      <ServerContent />
    </main>
    <Footer />
  </>
);
