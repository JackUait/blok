// docs/src/components/api/ApiPagination.tsx
import React from 'react';
import { Link } from 'react-router-dom';
import { useI18n } from '../../contexts/I18nContext';
import { MODULE_ORDER } from './api-nav';

interface ApiPaginationProps {
  currentId: string;
  labels: Record<string, string>;
  /** Linear page order; defaults to the API module order. */
  order?: string[];
}

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
          className="group flex flex-1 flex-col rounded-2xl border border-border bg-card px-5 py-4 text-left shadow-sm transition-shadow hover:shadow-card-hover"
          data-blok-testid="api-pagination-prev"
        >
          <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{t('api.pagination.previous')}</span>
          <span className="mt-1 font-display text-sm font-bold text-foreground">{labels[prev]}</span>
        </Link>
      ) : <span className="flex-1" aria-hidden />}
      {next ? (
        <Link
          to={`/docs/${next}`}
          className="group flex flex-1 flex-col rounded-2xl border border-border bg-card px-5 py-4 text-right shadow-sm transition-shadow hover:shadow-card-hover"
          data-blok-testid="api-pagination-next"
        >
          <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{t('api.pagination.next')}</span>
          <span className="mt-1 font-display text-sm font-bold text-foreground">{labels[next]}</span>
        </Link>
      ) : <span className="flex-1" aria-hidden />}
    </nav>
  );
};
