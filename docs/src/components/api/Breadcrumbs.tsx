// docs/src/components/api/Breadcrumbs.tsx
import { Fragment } from 'react';
import { Link } from '../common/Link';
import { useI18n } from '../../contexts/I18nContext';
import { Typo } from '../common/Typo';
import { getRouteMetadata } from '../../seo/route-metadata';
import { localizedPath } from '../../seo/locales';

interface BreadcrumbsProps {
  /** The currently-viewed module/tool id, e.g. "caret-api". */
  currentId: string;
  /** The current page's display title, e.g. "Caret API". */
  pageTitle: string;
}

/**
 * Trail above the page header: Home / Docs / <group> / <page title>.
 *
 * The linked crumbs come from route-metadata.ts, which is also what the page's
 * BreadcrumbList JSON-LD is built from — one definition, so the markup can
 * never describe a trail the reader cannot see. A route that declares no trail
 * renders nothing rather than a partial one.
 *
 * The final crumb (the current page) is plain text, not a link, and is the one
 * crumb the markup deliberately leaves out.
 */
export const Breadcrumbs: React.FC<BreadcrumbsProps> = ({ currentId, pageTitle }) => {
  const { t, locale } = useI18n();
  // route-metadata keys off the locale in the path, so ask it in the reader's tree.
  const trail = getRouteMetadata(localizedPath(`/docs/${currentId}`, locale))?.breadcrumbs;

  if (!trail) {
    return null;
  }

  return (
    <nav
      aria-label={t('api.breadcrumbsLabel')}
      data-blok-testid="api-breadcrumbs"
      className="mb-4 flex flex-wrap items-center gap-1.5 text-xs font-medium text-muted-foreground"
    >
      {trail.map((crumb) => (
        <Fragment key={crumb.path}>
          <Link to={crumb.path} className="transition-colors hover:text-foreground">
            <Typo>{crumb.name}</Typo>
          </Link>
          <span aria-hidden="true">/</span>
        </Fragment>
      ))}
      <span className="text-foreground" aria-current="page">
        <Typo>{pageTitle}</Typo>
      </span>
    </nav>
  );
};
