// docs/src/components/api/ApiModuleBody.tsx
import React, { useEffect } from 'react';
import { Navigate, useLocation, useParams } from 'react-router-dom';
import { ApiSection } from './ApiSection';
import { ApiPagination } from './ApiPagination';
import { ToolSection } from '../tools/ToolSection';
import { useApiTranslations } from '../../hooks/useApiTranslations';
import { useToolsTranslations } from '../../hooks/useToolsTranslations';
import { useLocalizedHref } from '../../contexts/I18nContext';

export const ApiModuleBody: React.FC = () => {
  const { moduleId } = useParams<{ moduleId: string }>();
  const { hash } = useLocation();
  const localizedHref = useLocalizedHref();
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
    return <Navigate to={localizedHref('/docs/quick-start')} replace />;
  }

  // Translated labels, keyed by id across every group, so the pagination
  // component can look up a neighbor's label regardless of which group it's in.
  const labels: Record<string, string> = {};
  for (const group of sidebarSections) {
    for (const link of group.links) labels[link.id] = link.label;
  }
  const currentId = (section ?? tool)!.id;

  // Prev/Next is scoped to the current sidebar GROUP, not the full flattened
  // list — otherwise the chain silently threads Tutorial -> Concepts -> How-to
  // -> all ~20 reference modules -> all tools into one global sequence. At the
  // last item of a group, Next is simply absent rather than jumping into the
  // next group; that's the deliberate, tested boundary (see ApiModuleBody.test.tsx).
  const currentGroup = sidebarSections.find((group) => group.links.some((link) => link.id === currentId));
  const order = currentGroup ? currentGroup.links.map((link) => link.id) : [currentId];

  return (
    <div data-blok-testid="api-module-body">
      {section ? <ApiSection section={section} /> : <ToolSection section={tool!} />}
      <ApiPagination currentId={currentId} labels={labels} order={order} />
    </div>
  );
};
