// docs/src/components/api/Breadcrumbs.tsx
import { Link } from '../common/Link';
import { useI18n } from '../../contexts/I18nContext';
import { useApiTranslations } from '../../hooks/useApiTranslations';
import { Typo } from '../common/Typo';

interface BreadcrumbsProps {
  /** The currently-viewed section/tool id, e.g. "caret-api". */
  currentId: string;
  /** The current page's display title, e.g. "Caret API". */
  pageTitle: string;
}

/**
 * Trail above the page header: Docs / <sidebar group> / <page title>.
 *
 * The group crumb links to the first page in its group rather than rendering
 * as plain text — every sidebar group has at least one concrete page, so
 * there's always a sensible landing spot for that level of the hierarchy.
 * The final crumb (the current page) is plain text, not a link.
 */
export const Breadcrumbs: React.FC<BreadcrumbsProps> = ({ currentId, pageTitle }) => {
  const { t } = useI18n();
  const { sidebarSections } = useApiTranslations();
  const group = sidebarSections.find((section) => section.links.some((link) => link.id === currentId));
  const groupFirstId = group?.links[0]?.id;

  return (
    <nav
      aria-label={t('api.breadcrumbsLabel')}
      data-blok-testid="api-breadcrumbs"
      className="mb-4 flex flex-wrap items-center gap-1.5 text-xs font-medium text-muted-foreground"
    >
      <Link to="/docs/quick-start" className="transition-colors hover:text-foreground">
        <Typo>{t('nav.docs')}</Typo>
      </Link>
      {group && (
        <>
          <span aria-hidden="true">/</span>
          {groupFirstId ? (
            <Link to={`/docs/${groupFirstId}`} className="transition-colors hover:text-foreground">
              <Typo>{group.title}</Typo>
            </Link>
          ) : (
            <span><Typo>{group.title}</Typo></span>
          )}
        </>
      )}
      <span aria-hidden="true">/</span>
      <span className="text-foreground" aria-current="page">
        <Typo>{pageTitle}</Typo>
      </span>
    </nav>
  );
};
