// docs/src/components/api/ApiPagination.tsx
import React from 'react';
import { Link } from 'react-router-dom';
import { useI18n } from '../../contexts/I18nContext';
import { Typo } from '../common/Typo';
import { MODULE_ORDER } from './api-nav';

interface ApiPaginationProps {
  currentId: string;
  labels: Record<string, string>;
  /** Linear page order; defaults to the API module order. */
  order?: string[];
}

// Wayfinding chevrons for the cards below, drawn in the same stroked,
// rounded-cap style as this folder's other hand-rolled icons (see
// ApiSection.tsx's GitHubIcon/InfoIcon convention).
const ArrowLeftIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    className={className}
  >
    <path d="M19 12H5" />
    <path d="M11 18l-6-6 6-6" />
  </svg>
);

const ArrowRightIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    className={className}
  >
    <path d="M5 12h14" />
    <path d="M13 6l6 6-6 6" />
  </svg>
);

export const ApiPagination: React.FC<ApiPaginationProps> = ({ currentId, labels, order = MODULE_ORDER }) => {
  const { t } = useI18n();
  const idx = order.indexOf(currentId);
  if (idx === -1) return null;
  const prev = idx > 0 ? order[idx - 1] : null;
  const next = idx < order.length - 1 ? order[idx + 1] : null;

  return (
    <nav
      className="mt-16 flex items-stretch justify-between gap-4 border-t border-border pt-8"
      aria-label={t('api.pagination.label')}
      data-blok-testid="api-pagination"
    >
      {prev ? (
        <Link
          to={`/docs/${prev}`}
          className="group flex flex-1 flex-col gap-1.5 rounded-2xl border border-border bg-card px-5 py-4 text-left shadow-sm transition-all duration-200 hover:border-foreground/15 hover:bg-secondary/40"
          data-blok-testid="api-pagination-prev"
        >
          <span className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground transition-colors duration-200 group-hover:text-foreground">
            <ArrowLeftIcon className="size-3.5 shrink-0 transition-transform duration-200 ease-out group-hover:-translate-x-0.5" />
            {t('api.pagination.previous')}
          </span>
          <span className="font-display text-sm font-bold text-foreground"><Typo>{labels[prev]}</Typo></span>
        </Link>
      ) : <span className="flex-1" aria-hidden />}
      {next ? (
        <Link
          to={`/docs/${next}`}
          className="group flex flex-1 flex-col gap-1.5 rounded-2xl border border-border bg-card px-5 py-4 text-right shadow-sm transition-all duration-200 hover:border-foreground/15 hover:bg-secondary/40"
          data-blok-testid="api-pagination-next"
        >
          <span className="flex items-center justify-end gap-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground transition-colors duration-200 group-hover:text-foreground">
            {t('api.pagination.next')}
            <ArrowRightIcon className="size-3.5 shrink-0 transition-transform duration-200 ease-out group-hover:translate-x-0.5" />
          </span>
          <span className="font-display text-sm font-bold text-foreground"><Typo>{labels[next]}</Typo></span>
        </Link>
      ) : <span className="flex-1" aria-hidden />}
    </nav>
  );
};
