// docs/src/components/api/ApiIndexRedirect.tsx
import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { resolveLegacyHash } from './api-nav';

export const ApiIndexRedirect: React.FC = () => {
  const { hash } = useLocation();
  const resolved = hash ? resolveLegacyHash(hash.slice(1)) : null;
  if (resolved) {
    const to = resolved.anchor
      ? `/docs/${resolved.moduleId}#${resolved.anchor}`
      : `/docs/${resolved.moduleId}`;
    return <Navigate to={to} replace />;
  }
  return <Navigate to="/docs/quick-start" replace />;
};
