import { Link } from '../common/Link';
import { Typo } from '../common/Typo';
import { useI18n } from '../../contexts/I18nContext';
import { useApiTranslations } from '../../hooks/useApiTranslations';
import { useToolsTranslations } from '../../hooks/useToolsTranslations';
import { getRouteMetadata } from '../../seo/route-metadata';

/**
 * The `/docs` landing page. It used to be a client-side redirect, which left
 * every one of the ~57 reference pages without a crawlable parent — the only
 * thing linking them was a sidebar that is `display: none` below `lg`. Listing
 * them here, grouped and described, gives the whole reference one plain-HTML
 * entry point.
 */
export const DocsHub: React.FC = () => {
  const { t, locale } = useI18n();
  const { apiSections, sidebarSections } = useApiTranslations();
  const { toolSections } = useToolsTranslations();

  // Fall back to English when the hub's own strings have no translation yet, so
  // a missing key never surfaces as a raw `api.hub.*` token on the page.
  const copy = (key: string, fallback: string): string => {
    const translated = t(key);
    return translated === key ? fallback : translated;
  };

  // Same split as ApiSection: route-metadata.ts owns the English H1, other
  // locales keep their translated string until /ru/** lands.
  const heading =
    (locale === 'en' ? getRouteMetadata('/docs')?.h1 : undefined) ??
    copy('api.hub.title', 'Blok documentation');

  const descriptions = new Map<string, string>();
  for (const section of apiSections) {
    if (section.description) descriptions.set(section.id, section.description);
  }
  for (const tool of toolSections) {
    if (!descriptions.has(tool.id)) descriptions.set(tool.id, tool.description);
  }

  return (
    <div className="flex flex-col gap-12" data-blok-testid="docs-hub">
      <div className="flex flex-col gap-3">
        <h1 className="font-display text-3xl font-extrabold tracking-tight text-foreground">
          <Typo>{heading}</Typo>
        </h1>
        <p className="max-w-2xl text-base leading-relaxed text-muted-foreground">
          <Typo>
            {copy(
              'api.hub.intro',
              'Guides, the full API reference, and every built-in block and inline tool. New here? Start with the quick start and have an editor running in five minutes.',
            )}
          </Typo>
        </p>
      </div>

      {sidebarSections.map((group) => (
        <section key={group.title} className="flex flex-col gap-4">
          <h2 className="font-display text-xs font-bold uppercase tracking-wide text-muted-foreground">
            <Typo>{group.title}</Typo>
          </h2>
          <ul className="grid gap-3 sm:grid-cols-2">
            {group.links.map((link) => (
              <li key={link.id} data-blok-testid={`docs-hub-entry-${link.id}`}>
                <Link
                  to={`/docs/${link.id}`}
                  className="flex h-full flex-col gap-1 rounded-xl border border-border bg-card px-4 py-3 transition-colors hover:border-foreground/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="text-sm font-semibold text-foreground">
                    <Typo>{link.label}</Typo>
                  </span>
                  {descriptions.has(link.id) && (
                    <span className="line-clamp-2 text-sm leading-relaxed text-muted-foreground">
                      <Typo>{descriptions.get(link.id)}</Typo>
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
};
