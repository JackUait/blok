import { useEffect, useMemo, useRef, useState } from "react";
import {
  AnimatePresence,
  motion,
  useReducedMotion,
  type Variants,
} from "framer-motion";
import { SectionReveal } from "../common/SectionReveal";
import { CodeBlock } from "../common/CodeBlock";
import { EditorWrapper } from "../demo/EditorWrapper";
import type { PackageManager } from "../common/PackageManagerToggle";
import { useI18n } from "../../contexts/I18nContext";

const PACKAGE_NAME = "@jackuait/blok";

const CONFIG_CODE = `import { Blok } from '@jackuait/blok';
import { Header, Paragraph, List, Bold, Italic, Link } from '@jackuait/blok/tools';

const editor = new Blok({
  holder: 'editor',
  tools: {
    paragraph: Paragraph,
    header: { class: Header, placeholder: 'Enter a heading' },
    list: List,
    bold: Bold,
    italic: Italic,
    link: Link,
  },
});`;

const SAVE_CODE = `const data = await editor.save();`;

// How long each step holds the spotlight before the walkthrough auto-advances.
const DWELL_MS = 5200;

// The rail items rise + fade in sequence as the section scrolls into view.
const railVariants: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.1, delayChildren: 0.04 } },
};

const stepVariants: Variants = {
  hidden: { opacity: 0, x: -16 },
  show: {
    opacity: 1,
    x: 0,
    transition: { type: "spring", stiffness: 240, damping: 26 },
  },
};

// Small chevron used by the window's prev / next controls.
const Chevron: React.FC<{ dir: "left" | "right" }> = ({ dir }) => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.4"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    className={dir === "left" ? "rotate-180" : undefined}
  >
    <path d="M9 6l6 6-6 6" />
  </svg>
);

const Check: React.FC = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M5 12.5l4.5 4.5L19 7" />
  </svg>
);

// The three traffic-light dots every window frame opens with.
const WindowDots: React.FC = () => (
  <div className="flex items-center gap-1.5" aria-hidden="true">
    <span className="size-2.5 rounded-full bg-foreground/15" />
    <span className="size-2.5 rounded-full bg-foreground/15" />
    <span className="size-2.5 rounded-full bg-foreground/15" />
  </div>
);

export const QuickStart: React.FC = () => {
  const { t } = useI18n();
  const reduce = useReducedMotion();
  const [packageManager, setPackageManager] = useState<PackageManager>("yarn");

  // The walkthrough's spotlight: `active` is the focused step, `auto` is the
  // self-driving carousel that yields permanently the moment a user steers it.
  const [active, setActive] = useState(0);
  const [auto, setAuto] = useState(true);

  const getInstallCommand = (manager: PackageManager): string => {
    switch (manager) {
      case "yarn":
        return `yarn add ${PACKAGE_NAME}`;
      case "npm":
        return `npm install ${PACKAGE_NAME}`;
      case "bun":
        return `bun add ${PACKAGE_NAME}`;
      default:
        return `npm install ${PACKAGE_NAME}`;
    }
  };

  const STEPS = useMemo(
    () => [
      {
        number: 1,
        title: t("api.quickStartSteps.install.title"),
        description: t("api.quickStartSteps.install.description"),
        file: t("home.quickStart.files.install"),
        language: "bash",
        isInstall: true,
      },
      {
        number: 2,
        title: t("api.quickStartSteps.configure.title"),
        description: t("api.quickStartSteps.configure.description"),
        file: t("home.quickStart.files.configure"),
        language: "typescript",
        isInstall: false,
      },
      {
        number: 3,
        title: t("api.quickStartSteps.save.title"),
        description: t("api.quickStartSteps.save.description"),
        file: t("home.quickStart.files.save"),
        language: "typescript",
        isInstall: false,
      },
    ],
    [t],
  );

  // Manual selection takes the wheel from the auto-player.
  const select = (index: number) => {
    setActive(index);
    setAuto(false);
  };
  const step = (delta: number) =>
    select((active + delta + STEPS.length) % STEPS.length);

  // Reduced-motion users get a calm, hand-driven walkthrough — never auto-play.
  useEffect(() => {
    if (reduce) setAuto(false);
  }, [reduce]);

  // The auto-player: dwell on the active step, then slide to the next one. The
  // long timeout never fires inside a synchronous test, keeping render stable.
  useEffect(() => {
    if (!auto || reduce) return;
    const id = setTimeout(
      () => setActive((a) => (a + 1) % STEPS.length),
      DWELL_MS,
    );
    return () => clearTimeout(id);
  }, [auto, reduce, active, STEPS.length]);

  // The live editor finale is heavy (full Blok bundle) — only mount it once it
  // scrolls within reach, so the landing paint stays fast and clean.
  const liveRef = useRef<HTMLDivElement>(null);
  const [liveInView, setLiveInView] = useState(false);
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const el = liveRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setLiveInView(true);
          io.disconnect();
        }
      },
      { rootMargin: "240px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const activeStep = STEPS[active];

  return (
    <section
      className="relative overflow-hidden bg-gradient-to-b from-background via-secondary/40 to-background py-24 sm:py-32"
      id="quick-start"
      data-blok-testid="quick-start-section"
    >
      {/* Warm sunset atmosphere — soft brand washes, no hard edges. */}
      <div
        className="pointer-events-none absolute inset-0 -z-10"
        data-blok-testid="quick-start-bg"
        aria-hidden="true"
      >
        <div
          className="absolute -top-28 left-1/2 size-[36rem] -translate-x-1/2 rounded-full bg-brand-from/[0.06] blur-3xl"
          data-blok-testid="quick-start-blur"
        ></div>
        <div className="absolute right-[6%] top-1/3 size-80 rounded-full bg-brand-to/[0.06] blur-3xl"></div>
        <div className="absolute bottom-[-4rem] left-[6%] size-72 rounded-full bg-primary/[0.04] blur-3xl"></div>
      </div>

      <div className="mx-auto w-full max-w-6xl px-6">
        <SectionReveal className="mx-auto max-w-2xl text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/[0.07] px-3.5 py-1.5 text-xs font-bold uppercase tracking-[0.14em] text-primary">
            <span className="size-1.5 rounded-full bg-primary" aria-hidden="true" />
            {t("home.quickStart.eyebrow")}
          </span>
          <h2 className="mt-5 text-3xl font-extrabold tracking-tight sm:text-4xl">
            {t("home.quickStart.title")}
          </h2>
        </SectionReveal>

        {/* The walkthrough stage: an interactive stepper that steers a single,
            persistent code window. Below lg the window stacks under the rail. */}
        <div className="mt-14 grid gap-8 sm:mt-16 lg:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)] lg:items-start lg:gap-12">
          {/* ── Left rail: the three steps, threaded by a gradient spine ── */}
          <motion.ol
            className="relative flex flex-col"
            data-blok-testid="install-steps"
            variants={railVariants}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, margin: "-80px" }}
          >
            {STEPS.map((s, index) => {
              const isActive = index === active;
              const isDone = index < active;
              const isLast = index === STEPS.length - 1;

              return (
                <motion.li key={s.number} variants={stepVariants}>
                  <button
                    type="button"
                    onClick={() => select(index)}
                    aria-current={isActive ? "step" : undefined}
                    data-blok-testid={`install-step-${s.number}`}
                    className="group/step flex w-full items-stretch gap-4 text-left focus-visible:outline-none"
                  >
                    {/* Node + the spine segment that drops toward the next step. */}
                    <div className="relative flex flex-col items-center">
                      <span
                        data-blok-testid={`step-number-${s.number}`}
                        className={`relative z-10 flex size-11 shrink-0 items-center justify-center rounded-2xl font-display text-lg font-extrabold tabular-nums transition-all duration-300 ${
                          isActive
                            ? "bg-brand-gradient text-white shadow-[0_10px_26px_-8px_color-mix(in_srgb,var(--brand-from)_70%,transparent)]"
                            : isDone
                              ? "bg-primary/12 text-primary"
                              : "border border-border bg-card text-muted-foreground group-hover/step:border-primary/40 group-hover/step:text-foreground"
                        }`}
                      >
                        <span className={isDone ? "sr-only" : undefined}>
                          {s.number}
                        </span>
                        {isDone && <Check />}
                      </span>
                      {!isLast && (
                        <span
                          aria-hidden="true"
                          className={`mt-1.5 w-[2px] flex-1 rounded-full transition-colors duration-500 ${
                            isDone ? "bg-brand-gradient" : "bg-border"
                          }`}
                        />
                      )}
                    </div>

                    {/* Title + description. The active step lifts onto a card and
                        carries the dwell-timer bar along its bottom edge. */}
                    <div
                      className={`relative mb-3 flex-1 overflow-hidden rounded-2xl px-4 py-3.5 transition-all duration-300 ${
                        isActive
                          ? "bg-card shadow-[0_8px_30px_-14px_rgba(0,0,0,0.22)] ring-1 ring-black/[0.05] dark:ring-white/[0.07]"
                          : "ring-1 ring-transparent group-hover/step:bg-card/60"
                      }`}
                    >
                      <h3
                        className={`text-base font-bold tracking-tight transition-colors ${
                          isActive ? "text-foreground" : "text-muted-foreground group-hover/step:text-foreground"
                        }`}
                      >
                        {s.title}
                      </h3>
                      <p
                        className="mt-1 text-[13.5px] leading-relaxed text-muted-foreground"
                        data-blok-testid={`step-description-${s.number}`}
                      >
                        {s.description}
                      </p>

                      {isActive && auto && !reduce && (
                        <span className="pointer-events-none absolute inset-x-0 bottom-0 h-[3px] bg-border/60">
                          <motion.span
                            key={active}
                            className="block h-full bg-brand-gradient"
                            initial={{ width: "0%" }}
                            animate={{ width: "100%" }}
                            transition={{ duration: DWELL_MS / 1000, ease: "linear" }}
                          />
                        </span>
                      )}
                    </div>
                  </button>
                </motion.li>
              );
            })}
          </motion.ol>

          {/* ── Right: one persistent window the rail drives ── */}
          <SectionReveal
            delay={0.1}
            className="lg:sticky lg:top-24"
          >
            <div
              className="overflow-hidden rounded-2xl border border-border bg-card shadow-[0_30px_70px_-30px_rgba(0,0,0,0.4)]"
              data-blok-testid="quick-start-window"
            >
              {/* Title bar: dots + the filename that morphs per step. */}
              <div className="flex items-center gap-3 border-b border-border/70 px-4 py-3">
                <WindowDots />
                <div className="relative ml-1 h-5 flex-1 overflow-hidden">
                  <AnimatePresence mode="wait" initial={false}>
                    <motion.span
                      key={activeStep.file}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -6 }}
                      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                      className="absolute inset-0 flex items-center font-mono text-[12px] text-muted-foreground"
                    >
                      {activeStep.file}
                    </motion.span>
                  </AnimatePresence>
                </div>
              </div>

              {/* Body: the active step's code, crossfading inside a height that
                  holds steady so the window never jumps as steps swap. */}
              <div className="relative min-h-[19rem]">
                <AnimatePresence mode="wait" initial={false}>
                  <motion.div
                    key={active}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
                  >
                    {activeStep.isInstall ? (
                      <CodeBlock
                        embedded
                        code={getInstallCommand(packageManager)}
                        language="bash"
                        showPackageManagerToggle
                        packageName={PACKAGE_NAME}
                        onPackageManagerChange={setPackageManager}
                      />
                    ) : (
                      <CodeBlock
                        embedded
                        code={active === 1 ? CONFIG_CODE : SAVE_CODE}
                        language={activeStep.language}
                      />
                    )}
                  </motion.div>
                </AnimatePresence>
              </div>

              {/* Status bar: step counter + prev/next, with the auto-play hint. */}
              <div className="flex items-center gap-3 border-t border-border/70 px-4 py-2.5">
                <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                  {String(active + 1).padStart(2, "0")}
                  <span className="text-foreground/25"> / </span>
                  {String(STEPS.length).padStart(2, "0")}
                </span>
                {auto && !reduce && (
                  <span className="hidden truncate text-[11px] text-muted-foreground/70 sm:inline">
                    {t("home.quickStart.autoHint")}
                  </span>
                )}
                <div className="ml-auto flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => step(-1)}
                    aria-label="Previous step"
                    className="inline-flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  >
                    <Chevron dir="left" />
                  </button>
                  <button
                    type="button"
                    onClick={() => step(1)}
                    aria-label="Next step"
                    className="inline-flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  >
                    <Chevron dir="right" />
                  </button>
                </div>
              </div>
            </div>
          </SectionReveal>
        </div>

        {/* ── Finale: the payoff. Not a screenshot — the real editor, live. ── */}
        <div
          ref={liveRef}
          className="mt-24 sm:mt-32"
          data-blok-testid="quick-start-live"
        >
          <SectionReveal className="mx-auto max-w-2xl text-center">
            <span className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/[0.07] px-3.5 py-1.5 text-xs font-bold uppercase tracking-[0.14em] text-primary">
              <span className="relative flex size-2 items-center justify-center" aria-hidden="true">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary/60" />
                <span className="relative inline-flex size-2 rounded-full bg-primary" />
              </span>
              {t("home.quickStart.live.badge")}
            </span>
            <h3 className="mt-5 text-2xl font-extrabold tracking-tight sm:text-3xl">
              {t("home.quickStart.live.title")}
            </h3>
            <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">
              {t("home.quickStart.live.subtitle")}
            </p>
          </SectionReveal>

          <SectionReveal delay={0.08} className="mt-10">
            <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-[0_30px_70px_-30px_rgba(0,0,0,0.4)]">
              <div className="flex items-center gap-3 border-b border-border/70 px-4 py-3">
                <WindowDots />
                <span className="ml-1 font-mono text-[12px] text-muted-foreground">
                  blok-editor
                </span>
                <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-primary">
                  <span className="size-1.5 rounded-full bg-primary" aria-hidden="true" />
                  {t("home.quickStart.live.ready")}
                </span>
              </div>
              <div className="px-2 py-2 sm:px-4 sm:py-4">
                {liveInView ? (
                  <EditorWrapper />
                ) : (
                  <div
                    className="flex min-h-[20rem] items-center justify-center"
                    aria-hidden="true"
                  >
                    <span className="size-8 animate-spin rounded-full border-2 border-border border-t-primary" />
                  </div>
                )}
              </div>
            </div>
          </SectionReveal>
        </div>
      </div>
    </section>
  );
};
