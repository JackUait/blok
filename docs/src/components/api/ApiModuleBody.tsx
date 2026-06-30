// docs/src/components/api/ApiModuleBody.tsx
import React, { useEffect } from 'react';
import { Navigate, useLocation, useParams } from 'react-router-dom';
import { ApiSection } from './ApiSection';
import { ApiPagination } from './ApiPagination';
import { ToolSection } from '../tools/ToolSection';
import { useApiTranslations } from '../../hooks/useApiTranslations';
import { useToolsTranslations } from '../../hooks/useToolsTranslations';

export const ApiModuleBody: React.FC = () => {
  const { moduleId } = useParams<{ moduleId: string }>();
  const { hash } = useLocation();
  const { apiSections, sidebarSections } = useApiTranslations();
  const { toolSections } = useToolsTranslations();
  const section = apiSections.find((s) => s.id === moduleId);
  const tool = !section ? toolSections.find((s) => s.id === moduleId) : undefined;

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

  if (!section && !tool) {
    return <Navigate to="/docs/quick-start" replace />;
  }

  // Translated labels + linear order for pagination, derived from the sidebar
  // so prev/next flows across the API modules and the tool pages alike.
  const labels: Record<string, string> = {};
  for (const group of sidebarSections) {
    for (const link of group.links) labels[link.id] = link.label;
  }
  const order = sidebarSections.flatMap((group) => group.links.map((link) => link.id));
  const currentId = (section ?? tool)!.id;

  return (
    <div data-blok-testid="api-module-body">
      {section ? <ApiSection section={section} /> : <ToolSection section={tool!} />}
      <ApiPagination currentId={currentId} labels={labels} order={order} />
    </div>
  );
};
