// docs/src/components/api/ApiIndexRedirect.tsx
import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { resolveLegacyHash } from './api-nav';
import { DocsHub } from './DocsHub';
import { useLocalizedHref } from '../../contexts/I18nContext';

/**
 * `/docs` — the hub page, plus the legacy single-page hash redirects it
 * inherited (`/docs#caret-api` and friends predate the per-module routes).
 * Only a recognised hash redirects; anything else renders a real page, because
 * a redirect prerenders as an empty shell and left the reference with no
 * crawlable parent.
 */
export const ApiIndexRedirect: React.FC = () => {
  const { hash } = useLocation();
  const localizedHref = useLocalizedHref();
  const resolved = hash ? resolveLegacyHash(hash.slice(1)) : null;
  if (resolved) {
    const to = resolved.anchor
      ? `/docs/${resolved.moduleId}#${resolved.anchor}`
      : `/docs/${resolved.moduleId}`;
    return <Navigate to={localizedHref(to)} replace />;
  }
  return <DocsHub />;
};
