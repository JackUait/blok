import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { type DocsVersion, VERSIONS_URL, currentVersionId, parseVersionsManifest, versionHref } from './versions';
import { stringsFor } from './strings';

const labelFor = (id: string, next: string) => (id === 'next' ? next : id);

export const VersionPicker = () => {
  const { pathname } = useLocation();
  const strings = stringsFor(pathname);
  const currentId = currentVersionId();
  const self: DocsVersion = { id: currentId, label: labelFor(currentId, strings.next), path: import.meta.env.BASE_URL };

  const [versions, setVersions] = useState<DocsVersion[]>([self]);
  const [pages, setPages] = useState<Record<string, string[] | null>>({});
  const [isOpen, setIsOpen] = useState(false);
  const [requested, setRequested] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Fetched on first open, never on mount: some pages must load with no network
  // request (ChangelogPage.test.tsx). The prerendered menu lists only the current version.
  useEffect(() => {
    if (!requested) return;
    let cancelled = false;
    fetch(VERSIONS_URL)
      .then((response) => (response.ok ? response.json() : null))
      .then((json) => {
        const manifest = parseVersionsManifest(json);
        if (cancelled || !manifest) return;
        setVersions(manifest.versions);
        manifest.versions.forEach((version) => {
          fetch(`${version.path}pages.json`)
            .then((response) => (response.ok ? response.json() : null))
            .then((list) => {
              if (cancelled) return;
              setPages((prev) => ({ ...prev, [version.id]: Array.isArray(list) ? list : null }));
            })
            .catch(() => undefined);
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [requested]);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setIsOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', escape);
    };
  }, []);

  return (
    // Hidden on phones: the 375px header has no spare width. The banner still links to latest.
    <div className="relative hidden sm:block" ref={containerRef}>
      <button
        type="button"
        className={cn(
          'flex h-9 cursor-pointer items-center gap-1 rounded-full px-3 text-sm font-semibold text-foreground/80 transition-colors hover:bg-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
          isOpen && 'bg-secondary text-foreground',
        )}
        onClick={() => {
          setIsOpen(!isOpen);
          setRequested(true);
        }}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-label={`${strings.pickerLabel}: ${self.label}`}
      >
        {self.label}
        <ChevronDown className="size-3.5" strokeWidth={2} />
      </button>

      <div
        className={cn(
          'absolute right-0 top-[calc(100%+0.5rem)] z-50 min-w-[10rem] origin-top-right rounded-2xl border border-border bg-popover p-1.5 shadow-card transition-all duration-150',
          isOpen ? 'pointer-events-auto scale-100 opacity-100' : 'pointer-events-none scale-95 opacity-0',
        )}
        role="menu"
        aria-label={strings.pickerLabel}
        aria-hidden={!isOpen}
      >
        {versions.map((version) => {
          const active = version.id === currentId;
          const label = labelFor(version.id, strings.next);
          return (
            // A plain <a>: every version is its own app.
            <a
              key={version.id}
              href={versionHref(version, pathname, pages[version.id] ?? null)}
              className={cn(
                'flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold transition-colors hover:bg-secondary',
                active && 'text-foreground',
              )}
              role="menuitem"
              aria-current={active ? 'true' : undefined}
              tabIndex={isOpen ? 0 : -1}
            >
              <span className="flex-1">{label}</span>
              <Check className={cn('size-4 transition-opacity', active ? 'opacity-100' : 'opacity-0')} strokeWidth={2.5} />
            </a>
          );
        })}
      </div>
    </div>
  );
};
