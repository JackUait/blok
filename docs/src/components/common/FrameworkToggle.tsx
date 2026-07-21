import { useI18n } from '../../contexts/I18nContext';
import {
  useFramework,
  FRAMEWORK_IDS,
  type Framework,
} from '../../contexts/FrameworkContext';
import { cn } from '@/lib/utils';
import { trackEvent, ANALYTICS_EVENTS } from '@/lib/analytics';

/** Monochrome brand marks (simple-icons), drawn in `currentColor`. */
const markProps = {
  width: 18,
  height: 18,
  viewBox: '0 0 24 24',
  fill: 'currentColor',
  'aria-hidden': true,
} as const;

const TsMark: React.FC = () => (
  <svg {...markProps}>
    <path d="M1.125 0C.502 0 0 .502 0 1.125v21.75C0 23.498.502 24 1.125 24h21.75c.623 0 1.125-.502 1.125-1.125V1.125C24 .502 23.498 0 22.875 0zm17.363 9.75c.612 0 1.154.037 1.627.111a6.38 6.38 0 0 1 1.306.34v2.458a3.95 3.95 0 0 0-.643-.361 5.093 5.093 0 0 0-.717-.26 5.453 5.453 0 0 0-1.426-.2c-.3 0-.573.028-.819.086a2.1 2.1 0 0 0-.623.242c-.17.104-.3.229-.393.374a.888.888 0 0 0-.14.49c0 .196.053.373.156.529.104.156.252.304.443.444s.423.276.696.41c.273.135.582.274.926.416.47.197.892.407 1.266.628.374.222.695.473.963.753.268.279.472.598.614.957.142.359.214.776.214 1.253 0 .657-.125 1.21-.373 1.656a3.033 3.033 0 0 1-1.012 1.085 4.38 4.38 0 0 1-1.487.596c-.566.12-1.163.18-1.79.18a9.916 9.916 0 0 1-1.84-.164 5.544 5.544 0 0 1-1.512-.493v-2.63a5.033 5.033 0 0 0 3.237 1.2c.333 0 .624-.03.872-.09.249-.06.456-.144.623-.25.166-.108.29-.234.373-.38a1.023 1.023 0 0 0-.074-1.089 2.12 2.12 0 0 0-.537-.5 5.597 5.597 0 0 0-.807-.444 27.72 27.72 0 0 0-1.007-.436c-.918-.383-1.602-.852-2.053-1.405-.45-.553-.676-1.222-.676-2.005 0-.614.123-1.141.369-1.582.246-.441.58-.804 1.004-1.089a4.494 4.494 0 0 1 1.47-.629 7.536 7.536 0 0 1 1.77-.201zm-15.113.188h9.563v2.166H9.506v9.646H6.789v-9.646H3.375z" />
  </svg>
);

const ReactMark: React.FC = () => (
  <svg {...markProps}>
    <path d="M14.23 12.004a2.236 2.236 0 0 1-2.235 2.236 2.236 2.236 0 0 1-2.236-2.236 2.236 2.236 0 0 1 2.235-2.236 2.236 2.236 0 0 1 2.236 2.236zm2.648-10.69c-1.346 0-3.107.96-4.888 2.622-1.78-1.653-3.542-2.602-4.887-2.602-.41 0-.783.093-1.106.278-1.375.793-1.683 3.264-.973 6.365C1.98 8.917 0 10.42 0 12.004c0 1.59 1.99 3.097 5.043 4.03-.704 3.113-.39 5.588.988 6.38.32.187.69.275 1.102.275 1.345 0 3.107-.96 4.888-2.624 1.78 1.654 3.542 2.603 4.887 2.603.41 0 .783-.09 1.106-.275 1.374-.792 1.683-3.263.973-6.365C22.02 15.096 24 13.59 24 12.004c0-1.59-1.99-3.097-5.043-4.032.704-3.11.39-5.587-.988-6.38-.318-.184-.688-.277-1.092-.278zm-.005 1.09v.006c.225 0 .406.044.558.127.666.382.955 1.835.73 3.704-.054.46-.142.945-.25 1.44-.96-.236-2.006-.417-3.107-.534-.66-.905-1.345-1.727-2.035-2.447 1.592-1.48 3.087-2.292 4.105-2.295zm-9.77.02c1.012 0 2.514.808 4.11 2.28-.686.72-1.37 1.537-2.02 2.442-1.107.117-2.154.298-3.113.538-.112-.49-.195-.964-.254-1.42-.23-1.868.054-3.32.714-3.707.19-.09.4-.127.563-.132zm4.882 3.05c.455.468.91.992 1.36 1.564-.44-.02-.89-.034-1.345-.034-.46 0-.915.01-1.36.034.44-.572.895-1.096 1.345-1.565zM12 8.1c.74 0 1.477.034 2.202.093.406.582.802 1.203 1.183 1.86.372.64.71 1.29 1.018 1.946-.308.655-.646 1.31-1.013 1.95-.38.66-.773 1.288-1.18 1.87-.728.063-1.466.098-2.21.098-.74 0-1.477-.035-2.202-.093-.406-.582-.802-1.204-1.183-1.86-.372-.64-.71-1.29-1.018-1.946.303-.657.646-1.313 1.013-1.954.38-.66.773-1.286 1.18-1.868.728-.064 1.466-.098 2.21-.098zm-3.635.254c-.24.377-.48.763-.704 1.16-.225.39-.435.782-.635 1.174-.265-.656-.49-1.31-.676-1.947.64-.15 1.315-.283 2.015-.386zm7.26 0c.695.103 1.365.23 2.006.387-.18.632-.405 1.282-.66 1.933-.2-.39-.41-.783-.64-1.174-.225-.392-.465-.774-.705-1.146zm3.063.675c.484.15.944.317 1.375.498 1.732.74 2.852 1.708 2.852 2.476-.005.768-1.125 1.74-2.857 2.475-.42.18-.88.342-1.355.493-.28-.958-.646-1.956-1.1-2.98.45-1.017.81-2.01 1.085-2.964zm-13.395.004c.278.96.645 1.957 1.1 2.98-.45 1.017-.812 2.01-1.086 2.964-.484-.15-.944-.318-1.37-.5-1.732-.737-2.852-1.706-2.852-2.474 0-.768 1.12-1.742 2.852-2.476.42-.18.88-.342 1.356-.494zm11.678 4.28c.265.657.49 1.312.676 1.948-.64.157-1.316.29-2.016.39.24-.375.48-.762.705-1.158.225-.39.435-.788.636-1.18zm-9.945.02c.2.392.41.783.64 1.175.23.39.465.772.705 1.143-.695-.102-1.365-.23-2.006-.386.18-.63.406-1.282.66-1.933zM17.92 16.32c.112.493.2.968.254 1.423.23 1.868-.054 3.32-.714 3.708-.147.09-.338.128-.563.128-1.012 0-2.514-.807-4.11-2.28.686-.72 1.37-1.536 2.02-2.44 1.107-.118 2.154-.3 3.113-.54zm-11.83.01c.96.234 2.006.415 3.107.532.66.905 1.345 1.727 2.035 2.446-1.595 1.483-3.092 2.295-4.11 2.295-.22-.005-.406-.05-.553-.132-.666-.38-.955-1.834-.73-3.703.054-.46.142-.944.25-1.438zm4.56.64c.44.02.89.034 1.345.034.46 0 .915-.01 1.36-.034-.44.572-.895 1.095-1.345 1.565-.455-.47-.91-.993-1.36-1.565z" />
  </svg>
);

const VueMark: React.FC = () => (
  <svg {...markProps}>
    <path d="M24,1.61H14.06L12,5.16,9.94,1.61H0L12,22.39ZM12,14.08,5.16,2.23H9.59L12,6.41l2.41-4.18h4.43Z" />
  </svg>
);

const AngularMark: React.FC = () => (
  <svg {...markProps}>
    <path d="M16.712 17.711H7.288l-1.204 2.916L12 24l5.916-3.373-1.204-2.916ZM14.692 0l7.832 16.855.814-12.856L14.692 0ZM9.308 0 .662 3.999l.814 12.856L9.308 0Zm-.405 13.93h6.198L12 6.396 8.903 13.93Z" />
  </svg>
);

interface FrameworkMeta {
  id: Framework;
  /** Human label — also the button's accessible name. */
  label: string;
  mark: React.ReactNode;
  /** Brand accent painted on the active mark. */
  color: string;
}

const FRAMEWORKS: FrameworkMeta[] = [
  { id: 'vanilla', label: 'JavaScript', mark: <TsMark />, color: '#3178c6' },
  { id: 'react', label: 'React', mark: <ReactMark />, color: '#149eca' },
  { id: 'vue', label: 'Vue', mark: <VueMark />, color: '#41b883' },
  { id: 'angular', label: 'Angular', mark: <AngularMark />, color: '#dd0031' },
];

const FRAMEWORK_META: Record<Framework, FrameworkMeta> = FRAMEWORKS.reduce(
  (acc, meta) => {
    acc[meta.id] = meta;
    return acc;
  },
  {} as Record<Framework, FrameworkMeta>,
);

/**
 * Segmented control that selects the framework whose code examples the docs
 * show. Shares the pill / sliding-indicator language of `PackageManagerToggle`
 * but is brand-icon led so it stays compact in the sidebar column. Selection is
 * global (FrameworkContext) and persisted, so it follows the reader page to page.
 */
export const FrameworkToggle: React.FC = () => {
  const { framework, setFramework } = useFramework();
  const { t } = useI18n();
  const selectedIndex = FRAMEWORK_IDS.indexOf(framework);

  const handleSelect = (next: Framework) => {
    // Clicking the active segment is a no-op, so it is not a selection.
    if (next !== framework) {
      trackEvent(ANALYTICS_EVENTS.selectFramework, { framework: next });
    }
    setFramework(next);
  };

  return (
    <div data-blok-testid="framework-toggle">
      <div className="mb-2 flex items-baseline justify-between gap-2 px-4">
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
          {t('frameworkToggle.label')}
        </span>
        <span className="text-[11px] font-semibold text-foreground">
          {FRAMEWORK_META[framework].label}
        </span>
      </div>
      <div
        className="relative grid grid-cols-4 items-center rounded-full bg-secondary p-0.5"
        role="group"
        aria-label={t('frameworkToggle.label')}
      >
        <span
          aria-hidden="true"
          className="pointer-events-none absolute top-0.5 bottom-0.5 left-0.5 rounded-full bg-background shadow-[0_1px_2px_rgba(0,0,0,0.08)] transition-transform duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)]"
          style={{
            width: 'calc((100% - 0.25rem) / 4)',
            transform: `translateX(${selectedIndex * 100}%)`,
          }}
        />
        {FRAMEWORKS.map((meta) => {
          const isActive = framework === meta.id;
          return (
            <button
              key={meta.id}
              type="button"
              className={cn(
                'relative z-10 flex h-8 cursor-pointer items-center justify-center rounded-full transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                isActive
                  ? 'text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
              style={isActive ? { color: meta.color } : undefined}
              onClick={() => handleSelect(meta.id)}
              aria-pressed={isActive}
              aria-label={`${t('frameworkToggle.switchAriaPrefix')} ${meta.label}`}
              title={meta.label}
            >
              {meta.mark}
            </button>
          );
        })}
      </div>
    </div>
  );
};
