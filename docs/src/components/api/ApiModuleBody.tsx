// docs/src/components/api/ApiModuleBody.tsx
import React from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { ApiSection } from './ApiSection';
import { ApiPagination } from './ApiPagination';
import { useApiTranslations } from '../../hooks/useApiTranslations';

export const ApiModuleBody: React.FC = () => {
  const { moduleId } = useParams<{ moduleId: string }>();
  const { apiSections, sidebarSections } = useApiTranslations();
  const section = apiSections.find((s) => s.id === moduleId);

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
