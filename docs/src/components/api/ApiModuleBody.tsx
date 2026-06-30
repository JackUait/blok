// docs/src/components/api/ApiModuleBody.tsx
import React, { useEffect } from 'react';
import { Navigate, useLocation, useParams } from 'react-router-dom';
import { ApiSection } from './ApiSection';
import { ApiPagination } from './ApiPagination';
import { useApiTranslations } from '../../hooks/useApiTranslations';

export const ApiModuleBody: React.FC = () => {
  const { moduleId } = useParams<{ moduleId: string }>();
  const { hash } = useLocation();
  const { apiSections, sidebarSections } = useApiTranslations();
  const section = apiSections.find((s) => s.id === moduleId);

  useEffect(() => {
    const id = hash.slice(1);
    if (!id) return;
    let raf = 0;
    let tries = 0;
    const tryScroll = () => {
      const el = document.getElementById(id);
      if (el) {
        el.scrollIntoView({ behavior: 'auto', block: 'start' });
        return;
      }
      if (tries < 20) {
        tries += 1;
        raf = requestAnimationFrame(tryScroll);
      }
    };
    raf = requestAnimationFrame(tryScroll);
    return () => cancelAnimationFrame(raf);
  }, [moduleId, hash]);

  if (!section) {
    return <Navigate to="/docs/quick-start" replace />;
  }

  // Translated labels for pagination, keyed by module id.
  const labels: Record<string, string> = {};
  for (const group of sidebarSections) {
    for (const link of group.links) labels[link.id] = link.label;
  }

  return (
    <div data-blok-testid="api-module-body">
      <ApiSection section={section} />
      <ApiPagination currentId={section.id} labels={labels} />
    </div>
  );
};
