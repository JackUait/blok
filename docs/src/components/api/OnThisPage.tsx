import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { useI18n } from '../../contexts/I18nContext';
import type { ApiSection } from './api-data';
import { generateMethodId, generatePropertyId, generateOptionId } from './api-anchors';

export interface OnThisPageItem {
  id: string;
  label: string;
}

export const getOnThisPageItems = (section: ApiSection): OnThisPageItem[] => {
  const items: OnThisPageItem[] = [];
  section.methods?.forEach((m) => items.push({ id: generateMethodId(section.id, m.name), label: m.name }));
  section.properties?.forEach((p) => items.push({ id: generatePropertyId(section.id, p.name), label: p.name }));
  section.table?.forEach((r) => items.push({ id: generateOptionId(section.id, r.option), label: r.option }));
  return items;
};

export const OnThisPage: React.FC<{ section: ApiSection }> = ({ section }) => {
  const { t } = useI18n();
  const items = getOnThisPageItems(section);
  const [activeId, setActiveId] = useState<string>(items[0]?.id ?? '');

  useEffect(() => {
    if (items.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting);
        if (visible.length > 0) setActiveId(visible[0].target.id);
      },
      { rootMargin: '-100px 0px -66% 0px', threshold: 0 },
    );
    items.forEach((it) => {
      const el = document.getElementById(it.id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
    // re-observe when the module (and thus its items) changes
  }, [section.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (items.length === 0) return null;

  return (
    <nav
      className="sticky top-24 max-h-[calc(100vh-8rem)] overflow-y-auto"
      aria-label={t('api.onThisPage')}
      data-blok-testid="on-this-page"
    >
      <h4 className="mb-3 text-xs font-bold uppercase tracking-wide text-muted-foreground">{t('api.onThisPage')}</h4>
      <ul className="flex flex-col gap-1 border-l border-border">
        {items.map((it) => (
          <li key={it.id}>
            <a
              href={`#${it.id}`}
              className={cn(
                '-ml-px block border-l-2 border-transparent py-1 pl-3 font-mono text-xs text-muted-foreground transition-colors hover:text-foreground',
                activeId === it.id && 'border-primary font-semibold text-foreground',
              )}
            >
              {it.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
};
