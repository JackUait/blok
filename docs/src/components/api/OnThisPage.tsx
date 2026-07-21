import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { Typo } from '../common/Typo';
import { useI18n } from '../../contexts/I18nContext';
import type { ApiSection } from './api-data';
import { generateMethodId, generatePropertyId, generateOptionId } from './api-anchors';
import { trackEvent, ANALYTICS_EVENTS } from '@/lib/analytics';

/** Hash-only jumps are invisible to page-view tracking, so record them here. */
const trackSectionJump = (sectionId: string, surface: 'rail' | 'dropdown'): void => {
  trackEvent(ANALYTICS_EVENTS.docsSectionJump, { section_id: sectionId, surface });
};

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

/** Scroll-spy state shared by both the persistent sidebar list (xl+) and the
    compact dropdown fallback (lg). */
const useOnThisPage = (section: ApiSection) => {
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

  return { items, activeId };
};

export const OnThisPage: React.FC<{ section: ApiSection }> = ({ section }) => {
  const { t } = useI18n();
  const { items, activeId } = useOnThisPage(section);

  if (items.length === 0) return null;

  return (
    <nav
      className="sticky top-24 max-h-[calc(100vh-8rem)] overflow-y-auto overscroll-contain"
      aria-label={t('api.onThisPage')}
      data-blok-testid="on-this-page"
    >
      <h4 className="mb-3 text-xs font-bold uppercase tracking-wide text-muted-foreground"><Typo>{t('api.onThisPage')}</Typo></h4>
      <ul className="flex flex-col gap-1 border-l border-border">
        {items.map((it) => (
          <li key={it.id}>
            <a
              href={`#${it.id}`}
              onClick={() => trackSectionJump(it.id, 'rail')}
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

/**
 * Compact dropdown fallback for the `lg` breakpoint range (1024–1279px),
 * where the persistent sidebar TOC (`OnThisPage`) has no room but shouldn't
 * just vanish. Mirrors MobileSectionNav's trigger + listbox pattern.
 */
export const OnThisPageDropdown: React.FC<{ section: ApiSection }> = ({ section }) => {
  const { t } = useI18n();
  const { items, activeId } = useOnThisPage(section);
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (event: MouseEvent): void => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen]);

  if (items.length === 0) return null;

  const activeLabel = items.find((it) => it.id === activeId)?.label ?? items[0]?.label;

  return (
    <div ref={containerRef} className="relative mb-4" data-blok-testid="on-this-page-dropdown">
      <button
        type="button"
        className={cn(
          'flex w-full cursor-pointer items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3 text-left shadow-sm transition-all hover:shadow-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          isOpen && 'border-foreground/20 shadow-card-hover',
        )}
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        data-blok-testid="on-this-page-dropdown-trigger"
      >
        <span className="flex min-w-0 flex-col">
          <span className="text-xs font-bold uppercase tracking-wide text-primary">
            <Typo>{t('api.onThisPage')}</Typo>
          </span>
          <span className="truncate font-mono text-sm font-semibold text-foreground">
            {activeLabel}
          </span>
        </span>
        <svg
          className={cn(
            'size-4 shrink-0 text-muted-foreground transition-transform duration-200',
            isOpen && 'rotate-180',
          )}
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {isOpen && (
        <div
          className="absolute left-0 right-0 top-[calc(100%+0.5rem)] z-50 max-h-[60vh] overflow-y-auto rounded-2xl border border-border bg-popover p-2 shadow-card"
          role="listbox"
          aria-label={t('api.onThisPage')}
          data-blok-testid="on-this-page-dropdown-list"
        >
          {items.map((it) => {
            const isActive = it.id === activeId;
            return (
              <a
                key={it.id}
                href={`#${it.id}`}
                role="option"
                aria-selected={isActive}
                onClick={() => {
                  trackSectionJump(it.id, 'dropdown');
                  setIsOpen(false);
                }}
                className={cn(
                  'flex w-full cursor-pointer items-center gap-2.5 rounded-xl px-3 py-2.5 text-left font-mono text-sm transition-colors hover:bg-secondary',
                  isActive ? 'bg-secondary font-semibold text-foreground' : 'text-muted-foreground',
                )}
                data-blok-testid={`on-this-page-dropdown-item-${it.id}`}
              >
                {it.label}
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
};
