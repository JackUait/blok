import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from '../common/Link';
import { useI18n } from '../../contexts/I18nContext';
import { Typo } from '../common/Typo';
import { Button } from '@/components/ui/button';
import { applyTypography } from '../../utils/typography';
import {
  splitWords,
  gradientSlice,
  toggleMark,
  introOffset,
  type HeroMark,
  type HeroMarks,
} from './heroText';

interface ToolbarState {
  ids: string[];
  x: number;
  y: number;
}

/** The editor's hover gutter: add + drag handle, shown beside the hovered block. Decorative. */
const Gutter: React.FC<{ className: string }> = ({ className }) => (
  <span
    aria-hidden="true"
    data-blok-testid="hero-gutter"
    className={`pointer-events-none absolute right-full mr-3 hidden items-center gap-0.5 text-muted-foreground/60 opacity-0 transition-[opacity,transform] duration-200 group-hover/block:translate-x-0 group-hover/block:opacity-100 lg:flex -translate-x-1 ${className}`}
  >
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M10 5v10M5 10h10" />
    </svg>
    <svg width="10" height="16" viewBox="0 0 7 13" className="fill-current">
      <circle cx="2" cy="2.5" r="1.05" />
      <circle cx="5" cy="2.5" r="1.05" />
      <circle cx="2" cy="6.5" r="1.05" />
      <circle cx="5" cy="6.5" r="1.05" />
      <circle cx="2" cy="10.5" r="1.05" />
      <circle cx="5" cy="10.5" r="1.05" />
    </svg>
  </span>
);

const markAttrs = (marks: HeroMark[] | undefined): Record<string, string | undefined> => ({
  'data-bold': marks?.includes('bold') ? '' : undefined,
  'data-italic': marks?.includes('italic') ? '' : undefined,
  'data-mark': marks?.includes('mark') ? '' : undefined,
});

/** Render a line as word spans joined by plain spaces, so the line's textContent stays the source string. */
const renderWords = (
  text: string,
  prefix: string,
  marks: HeroMarks,
  options: { firstIndex?: number; gradient?: boolean; intro?: boolean; trailing?: ReactNode }
): ReactNode[] => {
  const words = splitWords(text);

  return words.flatMap((word, n) => {
    const id = `${prefix}${n}`;
    const index = (options.firstIndex ?? 0) + n;
    const from = introOffset(index);
    const slice = options.gradient ? gradientSlice(word.offset, word.text.length, text.length) : null;
    const style = options.intro
      ? ({ '--i': index, '--hx': `${from.x}px`, '--hy': `${from.y}px`, '--hr': `${from.rotate}deg` } as CSSProperties)
      : undefined;

    const node = (
      <span key={id} data-hero-word={id} className={options.intro ? 'hero-word hero-word-in' : 'hero-word'} style={style} {...markAttrs(marks[id])}>
        <span
          className={slice ? 'hero-ink text-brand-gradient' : 'hero-ink'}
          style={slice ? { backgroundSize: slice.size, backgroundPosition: slice.position } : undefined}
        >
          {word.text}
        </span>
        {n === words.length - 1 ? options.trailing : null}
      </span>
    );

    return n === 0 ? [node] : [' ', node];
  });
};

const MARK_BUTTONS: { mark: HeroMark; labelKey: string; shortcut?: string; glyph: ReactNode }[] = [
  { mark: 'bold', labelKey: 'home.hero.format.bold', shortcut: 'B', glyph: <span className="text-[15px] font-extrabold">B</span> },
  { mark: 'italic', labelKey: 'home.hero.format.italic', shortcut: 'I', glyph: <span className="font-serif text-[16px] italic">I</span> },
  {
    mark: 'mark',
    labelKey: 'home.hero.format.highlight',
    glyph: (
      <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12.5 3.5l4 4-7.5 7.5H5v-4z" />
        <path d="M3 17.5h14" className="stroke-chart-2" strokeWidth="2.25" />
      </svg>
    ),
  },
];

const isCoarsePointer = (): boolean =>
  typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;

/**
 * The hero copy behaves like a Blok page: the title's words arrive as blocks and settle
 * into type, hovered blocks show the editor gutter, and selected words can be formatted
 * from a real inline toolbar. Formatting snaps to whole words and lives in React state,
 * so React never loses track of the text nodes it rendered.
 */
export const HeroCopy: React.FC = () => {
  const { t, locale } = useI18n();
  const rootRef = useRef<HTMLDivElement>(null);
  const [marks, setMarks] = useState<HeroMarks>({});
  const [toolbar, setToolbar] = useState<ToolbarState | null>(null);

  const title = applyTypography(t('home.hero.title'), locale);
  const titleGradient = applyTypography(t('home.hero.titleGradient'), locale);
  const description = applyTypography(t('home.hero.description'), locale);
  const titleWordCount = splitWords(title).length;

  useEffect(() => {
    const onSelectionChange = (): void => {
      const root = rootRef.current;
      const selection = window.getSelection();

      if (!root || !selection || selection.rangeCount === 0 || selection.isCollapsed || isCoarsePointer()) {
        setToolbar(null);
        return;
      }

      const range = selection.getRangeAt(0);

      if (!root.contains(range.commonAncestorContainer)) {
        setToolbar(null);
        return;
      }

      const ids: string[] = [];

      for (const el of root.querySelectorAll<HTMLElement>('[data-hero-word]')) {
        const word = document.createRange();
        word.selectNodeContents(el);
        const startsBeforeWordEnds = range.compareBoundaryPoints(Range.END_TO_START, word) < 0;
        const endsAfterWordStarts = range.compareBoundaryPoints(Range.START_TO_END, word) > 0;

        if (startsBeforeWordEnds && endsAfterWordStarts && el.dataset.heroWord) ids.push(el.dataset.heroWord);
      }

      if (ids.length === 0) {
        setToolbar(null);
        return;
      }

      // jsdom has no layout, so Range has no getBoundingClientRect there.
      const rect = typeof range.getBoundingClientRect === 'function' ? range.getBoundingClientRect() : null;
      const rootRect = root.getBoundingClientRect();

      setToolbar({
        ids,
        x: rect ? rect.left + rect.width / 2 - rootRect.left : 0,
        y: rect ? rect.top - rootRect.top : 0,
      });
    };

    document.addEventListener('selectionchange', onSelectionChange);
    window.addEventListener('resize', onSelectionChange);

    return () => {
      document.removeEventListener('selectionchange', onSelectionChange);
      window.removeEventListener('resize', onSelectionChange);
    };
  }, []);

  const apply = useCallback(
    (mark: HeroMark) => {
      if (toolbar) setMarks((prev) => toggleMark(prev, toolbar.ids, mark));
    },
    [toolbar]
  );

  // Shortcuts exist only while the toolbar is up, so they never fight the page's own keys.
  useEffect(() => {
    if (!toolbar) return;

    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        window.getSelection()?.removeAllRanges();
        setToolbar(null);
        return;
      }
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
      const key = e.key.toLowerCase();
      if (key === 'b' || key === 'i') {
        e.preventDefault();
        apply(key === 'b' ? 'bold' : 'italic');
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [toolbar, apply]);

  const isPressed = (mark: HeroMark): boolean => !!toolbar && toolbar.ids.every((id) => marks[id]?.includes(mark));
  const modKey = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';

  return (
    <div ref={rootRef} className="hero-copy relative text-center lg:text-left" data-blok-testid="hero-content">
      <div className="group/block relative">
        <Gutter className="top-[18px]" />
        <h1 className="hero-title text-4xl font-bold leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl">
          <span className="hero-line">{renderWords(title, 't', marks, { intro: true })}</span>{' '}
          <br />
          <span className="hero-line">
            {/* The caret rides inside the last word so it can never wrap onto a line of its own. */}
            {renderWords(titleGradient, 'g', marks, {
              intro: true,
              gradient: true,
              firstIndex: titleWordCount,
              trailing: <span aria-hidden="true" className="hero-type-caret" />,
            })}
          </span>
        </h1>
      </div>

      <div className="group/block relative mx-auto mt-6 max-w-xl lg:mx-0">
        <Gutter className="top-[5px]" />
        <p
          data-blok-testid="hero-description"
          className="hero-description text-lg leading-relaxed text-muted-foreground duration-700 animate-in fade-in slide-in-from-bottom-3 fill-mode-both delay-300"
        >
          {renderWords(description, 'd', marks, {})}
        </p>
      </div>

      <div className="group/block relative mt-9 hidden duration-700 animate-in fade-in slide-in-from-bottom-3 fill-mode-both delay-500 sm:block">
        <Gutter className="top-[15px]" />
        <div className="flex flex-col items-center justify-center gap-3 sm:flex-row lg:justify-start">
          <Button variant="brand" size="lg" className="hero-cta group/cta relative overflow-hidden" asChild>
            <Link to="/docs">
              <Typo>{t('home.hero.ctaGetStarted')}</Typo>
              <svg
                width="16"
                height="16"
                viewBox="0 0 20 20"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                className="transition-transform duration-300 group-hover/cta:translate-x-1"
              >
                <path d="M4 10h12M11 5l5 5-5 5" />
              </svg>
            </Link>
          </Button>
          <Button variant="outline" size="lg" asChild>
            <Link to="/demo">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
              <Typo>{t('home.hero.ctaTryItOut')}</Typo>
            </Link>
          </Button>
        </div>
        <p className="mt-5 hidden items-center gap-2 text-sm text-muted-foreground/80 lg:flex" data-blok-testid="hero-select-hint">
          <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
            <path d="M7 3.5h2.5M7 16.5h2.5M10.5 3.5h2.5M10.5 16.5h2.5M10 3.5v13" />
          </svg>
          <Typo>{t('home.hero.selectHint')}</Typo>
        </p>
      </div>

      {toolbar && (
        <div
          role="toolbar"
          aria-label={t('home.hero.format.label')}
          className="hero-format-toolbar absolute z-30 flex items-center gap-0.5 rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-card-hover"
          style={{ left: toolbar.x, top: toolbar.y }}
          onMouseDown={(e) => e.preventDefault()}
        >
          {MARK_BUTTONS.map(({ mark, labelKey, shortcut, glyph }) => (
            <button
              key={mark}
              type="button"
              aria-label={t(labelKey)}
              aria-pressed={isPressed(mark)}
              title={shortcut ? `${t(labelKey)} ${modKey}${shortcut}` : t(labelKey)}
              onClick={() => apply(mark)}
              className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground aria-pressed:bg-muted aria-pressed:text-foreground"
            >
              {glyph}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
