import { useEffect, useMemo, useRef, useState } from "react";
import { motion, useInView, type Variants } from "framer-motion";
import { SectionReveal } from "../common/SectionReveal";
import { FeatureModal, type FeatureDetail } from "./FeatureModal";
import { useI18n } from "../../contexts/I18nContext";

// Cards rise + fade in sequence as the grid scrolls into view.
const gridVariants: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.07, delayChildren: 0.04 } },
};

const cardVariants: Variants = {
  hidden: { opacity: 0, y: 22 },
  show: {
    opacity: 1,
    y: 0,
    transition: { type: "spring", stiffness: 240, damping: 24 },
  },
};

// Each pillar springs up to full size as it becomes the focused card in the
// carousel, and rests slightly smaller + dimmed while it's a peeking neighbour.
// On desktop every card is in view at once, so they all sit focused.
const pillarVariants: Variants = {
  unfocused: { scale: 0.88, opacity: 0.5 },
  focused: {
    scale: 1,
    opacity: 1,
    transition: { type: "spring", stiffness: 260, damping: 26 },
  },
};

// Bouncy spring for hover lift + tap feedback — a touch of overshoot gives the
// cards a playful, alive feel without feeling sluggish.
const hoverSpring = { type: "spring", stiffness: 380, damping: 20 } as const;

// Each pillar glyph animates its OWN internals to echo what the icon MEANS,
// rather than sharing one generic whole-element move. The shared spring keeps
// them feeling like one family; the per-part orchestration (below) is what makes
// each unique and on-context.
const glyphSpring = { type: "spring", stiffness: 280, damping: 18 } as const;

// Parent SVG variants: hold until the card is in view, then release the parts in
// sequence. `delayChildren` carries the per-card stagger so the three cards fire
// one after another, not all at once.
const glyphContainer = (delay: number, stagger: number): Variants => ({
  hidden: {},
  shown: { transition: { delayChildren: delay, staggerChildren: stagger } },
});

type GlyphProps = { state: "hidden" | "shown"; delay: number };

// 0 — Clean JSON: the two braces slide in from opposite edges and meet in the
// middle, the way brackets close around the value they enclose.
const BracesGlyph: React.FC<GlyphProps> = ({ state, delay }) => (
  <motion.svg
    viewBox="0 0 32 32"
    fill="none"
    className="overflow-visible"
    initial="hidden"
    animate={state}
    variants={glyphContainer(delay, 0.08)}
  >
    <motion.path
      d="M12 8L8 16l4 8"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      variants={{ hidden: { opacity: 0, x: -14 }, shown: { opacity: 1, x: 0 } }}
      transition={glyphSpring}
    />
    <motion.path
      d="M20 8l4 8-4 8"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      variants={{ hidden: { opacity: 0, x: 14 }, shown: { opacity: 1, x: 0 } }}
      transition={glyphSpring}
    />
  </motion.svg>
);

// 1 — Blocks for everything: the three blocks pop in one after another, each
// scaling up from its own centre, like blocks being stacked into place.
const BlocksGlyph: React.FC<GlyphProps> = ({ state, delay }) => {
  const block: Variants = {
    hidden: { opacity: 0, scale: 0.3, y: -3 },
    shown: { opacity: 1, scale: 1, y: 0 },
  };
  const pivot = { transformBox: "fill-box", transformOrigin: "center" } as const;
  return (
    <motion.svg
      viewBox="0 0 32 32"
      fill="none"
      initial="hidden"
      animate={state}
      variants={glyphContainer(delay, 0.14)}
    >
      <motion.rect x="6" y="6" width="10" height="8" rx="2" stroke="currentColor" strokeWidth="2" variants={block} transition={glyphSpring} style={pivot} />
      <motion.rect x="16" y="10" width="10" height="8" rx="2" stroke="currentColor" strokeWidth="2" variants={block} transition={glyphSpring} style={pivot} />
      <motion.rect x="8" y="18" width="10" height="8" rx="2" stroke="currentColor" strokeWidth="2" variants={block} transition={glyphSpring} style={pivot} />
    </motion.svg>
  );
};

// 2 — Extensible by design: the dashed "drop zone" frame settles in first, then
// the plus literally draws itself stroke-by-stroke — the gesture of adding a new
// block into the slot.
const ExtensibleGlyph: React.FC<GlyphProps> = ({ state, delay }) => {
  const stroke: Variants = {
    hidden: { pathLength: 0, opacity: 0 },
    shown: { pathLength: 1, opacity: 1 },
  };
  return (
    <motion.svg
      viewBox="0 0 32 32"
      fill="none"
      initial="hidden"
      animate={state}
      variants={glyphContainer(delay, 0.16)}
    >
      <motion.rect
        x="6"
        y="6"
        width="20"
        height="20"
        rx="4"
        stroke="currentColor"
        strokeWidth="2"
        strokeDasharray="4 3"
        variants={{ hidden: { opacity: 0, scale: 0.65 }, shown: { opacity: 1, scale: 1 } }}
        transition={glyphSpring}
        style={{ transformBox: "fill-box", transformOrigin: "center" }}
      />
      <motion.path d="M16 11v10" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" variants={stroke} transition={{ duration: 0.3, ease: "easeOut" }} />
      <motion.path d="M11 16h10" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" variants={stroke} transition={{ duration: 0.3, ease: "easeOut" }} />
    </motion.svg>
  );
};

const PILLAR_GLYPHS = [BracesGlyph, BlocksGlyph, ExtensibleGlyph];

// Renders the right animated glyph for a pillar and gates it on scroll-into-view.
// The ref sits on the STATIC outer span (never the animated SVG) so the observer
// box stays put; `animate` toggles the whole part-orchestration on each entry, so
// the glyph re-plays its contextual animation every time the card scrolls in.
const PillarGlyph: React.FC<{ index: number }> = ({ index }) => {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { amount: 0.3 });
  const Glyph = PILLAR_GLYPHS[index] ?? PILLAR_GLYPHS[0];

  return (
    <span
      ref={ref}
      aria-hidden="true"
      className="pointer-events-none absolute -bottom-10 -right-8 size-44 text-primary/[0.06] transition-colors duration-500 group-hover:text-primary/[0.11] [&_svg]:size-full"
    >
      <span className="block size-full transition-transform duration-500 ease-out group-hover:-rotate-6 group-hover:scale-110">
        <Glyph state={inView ? "shown" : "hidden"} delay={index * 0.12} />
      </span>
    </span>
  );
};

export const Features: React.FC = () => {
  const { t } = useI18n();
  const [selectedFeature, setSelectedFeature] = useState<FeatureDetail | null>(
    null,
  );
  // On mobile the three pillars collapse into a horizontal snap-scroll carousel;
  // `activeIndex` drives the pagination dots and the focus scale-up. Only the
  // centred card grows to full size — neighbours rest smaller + dimmed. On the
  // desktop grid every card is shown at once, so the focus effect is disabled.
  const carouselRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isCarousel, setIsCarousel] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(max-width: 767px)").matches,
  );

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const update = () => setIsCarousel(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  const FEATURES = useMemo<FeatureDetail[]>(() => [
    {
      icon: (
        <svg width="28" height="28" viewBox="0 0 32 32" fill="none" className="fi fi-json">
          {/* JSON braces */}
          <path d="M12 8L8 16l4 8" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M20 8l4 8-4 8" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ),
      title: t('home.features.cleanJson.title'),
      description: t('home.features.cleanJson.description'),
      learnMore: t('home.features.cleanJson.learnMore'),
      accent: "coral",
      tier: "primary",
      details: {
        summary: t('home.features.cleanJson.details.summary'),
        benefits: [
          t('home.features.cleanJson.details.benefit1'),
          t('home.features.cleanJson.details.benefit2'),
          t('home.features.cleanJson.details.benefit3'),
          t('home.features.cleanJson.details.benefit4'),
        ],
        codeExample: `const data = await editor.save();
// { blocks: [{ id: "x1", type: "paragraph", data: { text: "Hello" } }] }`,
        apiLink: "/docs#saver-api",
      },
    },
    {
      icon: (
        <svg width="28" height="28" viewBox="0 0 32 32" fill="none" className="fi fi-blocks">
          {/* Stacked blocks — the block library */}
          <rect x="6" y="6" width="10" height="8" rx="2" stroke="currentColor" strokeWidth="2" />
          <rect x="16" y="10" width="10" height="8" rx="2" stroke="currentColor" strokeWidth="2" />
          <rect x="8" y="18" width="10" height="8" rx="2" stroke="currentColor" strokeWidth="2" />
        </svg>
      ),
      title: t('home.features.blockLibrary.title'),
      description: t('home.features.blockLibrary.description'),
      learnMore: t('home.features.blockLibrary.learnMore'),
      accent: "green",
      tier: "primary",
      details: {
        summary: t('home.features.blockLibrary.details.summary'),
        benefits: [
          t('home.features.blockLibrary.details.benefit1'),
          t('home.features.blockLibrary.details.benefit2'),
          t('home.features.blockLibrary.details.benefit3'),
          t('home.features.blockLibrary.details.benefit4'),
        ],
        codeExample: `import Blok from '@jackuait/blok/full';

// Tables, databases, columns, code, media and embeds — all registered
new Blok({ holder: 'editor' });`,
        apiLink: "/tools",
      },
    },
    {
      icon: (
        <svg width="28" height="28" viewBox="0 0 32 32" fill="none" className="fi fi-ext">
          {/* Dashed frame + plus — bring your own block */}
          <rect x="6" y="6" width="20" height="20" rx="4" stroke="currentColor" strokeWidth="2" strokeDasharray="4 3" />
          <path d="M16 11v10M11 16h10" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
        </svg>
      ),
      title: t('home.features.customBlocks.title'),
      description: t('home.features.customBlocks.description'),
      learnMore: t('home.features.customBlocks.learnMore'),
      accent: "orange",
      tier: "primary",
      details: {
        summary: t('home.features.customBlocks.details.summary'),
        benefits: [
          t('home.features.customBlocks.details.benefit1'),
          t('home.features.customBlocks.details.benefit2'),
          t('home.features.customBlocks.details.benefit3'),
          t('home.features.customBlocks.details.benefit4'),
        ],
        codeExample: `class MyTool {
  static get toolbox() {
    return { title: 'My Tool', icon: '<svg>...</svg>' };
  }
  render() { return document.createElement('div'); }
  save(element) { return { text: element.innerHTML }; }
}`,
        apiLink: "/docs#tools-api",
      },
    },
    {
      icon: (
        <svg width="28" height="28" viewBox="0 0 32 32" fill="none" className="fi fi-slash">
          {/* Menu box with slash */}
          <rect x="6" y="8" width="20" height="16" rx="3" stroke="currentColor" strokeWidth="2" />
          <path d="M18 12L14 20" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
        </svg>
      ),
      title: t('home.features.slashCommands.title'),
      description: t('home.features.slashCommands.description'),
      learnMore: t('home.features.slashCommands.learnMore'),
      accent: "pink",
      details: {
        summary: t('home.features.slashCommands.details.summary'),
        benefits: [
          t('home.features.slashCommands.details.benefit1'),
          t('home.features.slashCommands.details.benefit2'),
          t('home.features.slashCommands.details.benefit3'),
          t('home.features.slashCommands.details.benefit4'),
        ],
        codeExample: `new Blok({
  tools: {
    myBlock: {
      class: MyBlockTool,
      toolbox: { title: 'My Block', icon: '<svg>...</svg>' }
    }
  }
});`,
        apiLink: "/docs#toolbar-api",
      },
    },
    {
      icon: (
        <svg width="28" height="28" viewBox="0 0 32 32" fill="none" className="fi fi-kanban">
          {/* Kanban columns */}
          <rect x="5" y="6" width="6" height="20" rx="1.5" stroke="currentColor" strokeWidth="2" />
          <rect x="13" y="6" width="6" height="13" rx="1.5" stroke="currentColor" strokeWidth="2" />
          <rect x="21" y="6" width="6" height="16" rx="1.5" stroke="currentColor" strokeWidth="2" />
        </svg>
      ),
      title: t('home.features.databases.title'),
      description: t('home.features.databases.description'),
      learnMore: t('home.features.databases.learnMore'),
      accent: "purple",
      details: {
        summary: t('home.features.databases.details.summary'),
        benefits: [
          t('home.features.databases.details.benefit1'),
          t('home.features.databases.details.benefit2'),
          t('home.features.databases.details.benefit3'),
          t('home.features.databases.details.benefit4'),
        ],
        apiLink: "/tools#database",
      },
    },
    {
      icon: (
        <svg width="28" height="28" viewBox="0 0 32 32" fill="none" className="fi fi-table">
          {/* Table grid */}
          <rect x="5" y="7" width="22" height="18" rx="2" stroke="currentColor" strokeWidth="2" />
          <path d="M5 13h22M5 19h22M13 7v18M20 7v18" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      ),
      title: t('home.features.tables.title'),
      description: t('home.features.tables.description'),
      learnMore: t('home.features.tables.learnMore'),
      accent: "cyan",
      details: {
        summary: t('home.features.tables.details.summary'),
        benefits: [
          t('home.features.tables.details.benefit1'),
          t('home.features.tables.details.benefit2'),
          t('home.features.tables.details.benefit3'),
          t('home.features.tables.details.benefit4'),
        ],
        apiLink: "/tools#table",
      },
    },
    {
      icon: (
        <svg width="28" height="28" viewBox="0 0 32 32" fill="none" className="fi fi-embed">
          {/* Embed frame with play */}
          <rect x="5" y="7" width="22" height="18" rx="3" stroke="currentColor" strokeWidth="2" />
          <path d="M14 12.5l5.5 3.5-5.5 3.5z" fill="currentColor" />
        </svg>
      ),
      title: t('home.features.embeds.title'),
      description: t('home.features.embeds.description'),
      learnMore: t('home.features.embeds.learnMore'),
      accent: "blue",
      details: {
        summary: t('home.features.embeds.details.summary'),
        benefits: [
          t('home.features.embeds.details.benefit1'),
          t('home.features.embeds.details.benefit2'),
          t('home.features.embeds.details.benefit3'),
          t('home.features.embeds.details.benefit4'),
        ],
        apiLink: "/tools#embed",
      },
    },
    {
      icon: (
        <svg width="28" height="28" viewBox="0 0 32 32" fill="none" className="fi fi-history">
          {/* Undo / redo arrows */}
          <path d="M10 16a6 6 0 0 1 6-6h2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <path d="M16 7l3 3-3 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M22 16a6 6 0 0 1-6 6h-2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.5" />
          <path d="M16 25l-3-3 3-3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity="0.5" />
        </svg>
      ),
      title: t('home.features.undoRedo.title'),
      description: t('home.features.undoRedo.description'),
      learnMore: t('home.features.undoRedo.learnMore'),
      accent: "yellow",
      details: {
        summary: t('home.features.undoRedo.details.summary'),
        benefits: [
          t('home.features.undoRedo.details.benefit1'),
          t('home.features.undoRedo.details.benefit2'),
          t('home.features.undoRedo.details.benefit3'),
          t('home.features.undoRedo.details.benefit4'),
        ],
        apiLink: "/docs#history-api",
      },
    },
    {
      icon: (
        <svg width="28" height="28" viewBox="0 0 32 32" fill="none" className="fi fi-globe">
          {/* Globe */}
          <circle cx="16" cy="16" r="9" stroke="currentColor" strokeWidth="2" />
          <ellipse cx="16" cy="16" rx="4" ry="9" stroke="currentColor" strokeWidth="1.5" />
          <path d="M8 12h16M8 20h16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      ),
      title: t('home.features.languages.title'),
      description: t('home.features.languages.description'),
      learnMore: t('home.features.languages.learnMore'),
      accent: "mauve",
      details: {
        summary: t('home.features.languages.details.summary'),
        benefits: [
          t('home.features.languages.details.benefit1'),
          t('home.features.languages.details.benefit2'),
          t('home.features.languages.details.benefit3'),
          t('home.features.languages.details.benefit4'),
        ],
        codeExample: `new Blok({
  i18n: { locale: 'ar' } // Arabic with RTL
});`,
        apiLink: "/docs#i18n-api",
      },
    },
  ], [t]);

  const primaryFeatures = FEATURES.filter((f) => f.tier === "primary");
  const secondaryFeatures = FEATURES.filter((f) => f.tier !== "primary");

  const handleFeatureClick = (feature: FeatureDetail) => {
    setSelectedFeature(feature);
  };

  const handleCloseModal = () => {
    setSelectedFeature(null);
  };

  // Track which pillar is centred in the scrollport so the right dot lights up.
  const handleCarouselScroll = () => {
    const el = carouselRef.current;
    if (!el) return;
    const cards = Array.from(el.children) as HTMLElement[];
    const viewportCenter = el.getBoundingClientRect().left + el.clientWidth / 2;
    let closest = 0;
    let minDistance = Infinity;
    cards.forEach((card, index) => {
      const rect = card.getBoundingClientRect();
      const distance = Math.abs(rect.left + rect.width / 2 - viewportCenter);
      if (distance < minDistance) {
        minDistance = distance;
        closest = index;
      }
    });
    setActiveIndex(closest);
  };

  const scrollToCard = (index: number) => {
    const card = carouselRef.current?.children[index] as HTMLElement | undefined;
    card?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  };

  return (
    <section
      className="py-20 sm:py-28"
      id="features"
      aria-label={t('home.features.sectionLabel')}
    >
      <div className="mx-auto w-full max-w-6xl px-6">
        <SectionReveal className="max-w-2xl">
          <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            <span className="block">{t('home.features.title1')}</span>
            <span className="block">{t('home.features.title2')}</span>
          </h2>
          <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
            {t('home.features.description')}
          </p>
        </SectionReveal>

        {/* The three pillars that define Blok — large, scanned first.
            Mobile: a horizontal snap-scroll carousel. Cards snap to centre and
            sit at ~74vw, so a middle card shows a peek of BOTH neighbours; the
            13vw side padding lets the first/last card centre at the extremes.
            md+: a static three-up grid. */}
        <div
          ref={carouselRef}
          onScroll={handleCarouselScroll}
          className="-mx-6 mt-14 flex snap-x snap-mandatory gap-5 overflow-x-auto scroll-px-[13vw] px-[13vw] pb-2 [-ms-overflow-style:none] [scrollbar-width:none] md:mx-0 md:grid md:grid-cols-3 md:overflow-visible md:px-0 md:scroll-px-0 md:pb-0 [&::-webkit-scrollbar]:hidden"
        >
          {primaryFeatures.map((feature, index) => (
            <motion.button
              type="button"
              key={feature.accent}
              variants={pillarVariants}
              initial={false}
              animate={
                !isCarousel || index === activeIndex ? "focused" : "unfocused"
              }
              data-pillar-focused={
                isCarousel && index === activeIndex ? "true" : undefined
              }
              whileHover={{ y: -4 }}
              whileTap={{ scale: 0.98 }}
              transition={hoverSpring}
              className="group relative flex w-[74vw] shrink-0 snap-center cursor-pointer flex-col items-start overflow-hidden rounded-3xl border border-border/60 bg-card p-8 text-left transition-[border-color] duration-300 hover:border-primary/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background md:w-auto md:shrink"
              onClick={() => handleFeatureClick(feature)}
              aria-label={feature.learnMore}
            >
              <PillarGlyph index={index} />
              <div className="relative z-10 space-y-3">
                <div>
                  <span
                    aria-hidden="true"
                    className="mb-3.5 block h-[3px] w-9 rounded-full bg-linear-to-r from-brand-from via-brand-via to-brand-to transition-[width] duration-300 group-hover:w-14"
                  />
                  <h3 className="text-2xl font-bold leading-[1.15] tracking-tight">
                    {feature.title}
                  </h3>
                </div>
                <p className="text-[15px] leading-relaxed text-muted-foreground">
                  {feature.description}
                </p>
              </div>
              <span className="relative z-10 mt-7 flex w-full items-center border-t border-border/50 pt-4 text-sm font-medium text-primary">
                {t('home.features.learnMoreLabel')}
                <span className="ml-auto flex size-7 items-center justify-center rounded-full border border-primary/30 bg-card text-primary transition-[background-color,color,border-color] duration-200 group-hover:border-primary group-hover:bg-primary group-hover:text-primary-foreground">
                  <svg
                    width="15"
                    height="15"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                    className="transition-transform duration-200 group-hover:translate-x-0.5"
                  >
                    <path d="M5 12h14M12 5l7 7-7 7" />
                  </svg>
                </span>
              </span>
            </motion.button>
          ))}
        </div>

        {/* Carousel pagination — mobile only; the grid shows all three at md+. */}
        <div
          className="mt-5 flex justify-center gap-2 md:hidden"
          role="group"
          aria-label={t('home.features.sectionLabel')}
        >
          {primaryFeatures.map((feature, index) => {
            const isActive = index === activeIndex;
            return (
              <button
                key={feature.accent}
                type="button"
                onClick={() => scrollToCard(index)}
                aria-current={isActive ? "true" : undefined}
                aria-label={`Go to ${feature.title}`}
                className={`h-2 rounded-full transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
                  isActive ? "w-6 bg-primary" : "w-2 bg-foreground/15"
                }`}
              />
            );
          })}
        </div>

        {/* Supporting capabilities — quiet Airbnb chips, scanned second. */}
        <motion.div
          className="mt-10 grid grid-cols-2 gap-3 sm:mt-4 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3"
          variants={gridVariants}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: "-60px" }}
        >
          {secondaryFeatures.map((feature) => (
            <motion.button
              type="button"
              key={feature.accent}
              variants={cardVariants}
              whileHover={{ y: -3 }}
              whileTap={{ scale: 0.98 }}
              transition={hoverSpring}
              className="group flex min-h-[116px] cursor-pointer flex-col items-start gap-3 rounded-2xl border border-black/[0.04] bg-secondary p-4 text-left transition-shadow duration-300 hover:shadow-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background dark:border-white/[0.08] sm:min-h-[68px] sm:flex-row sm:items-center sm:gap-3.5"
              onClick={() => handleFeatureClick(feature)}
              aria-label={feature.learnMore}
            >
              <div className="feature-blob flex size-11 shrink-0 items-center justify-center bg-primary/10 text-primary transition-[background-color,color,transform] duration-300 group-hover:scale-110 group-hover:bg-linear-to-br group-hover:from-brand-from group-hover:via-brand-via group-hover:to-brand-to group-hover:text-white sm:size-10">
                {feature.icon}
              </div>
              <h3 className="max-w-[7rem] text-[14px] font-medium leading-snug tracking-tight sm:max-w-none sm:flex-1 sm:text-[15px]">
                {feature.title}
              </h3>
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                className="mt-auto shrink-0 self-end text-primary/40 transition-all duration-300 group-hover:translate-x-0.5 group-hover:text-primary sm:mt-0 sm:self-auto sm:text-muted-foreground/50 sm:opacity-0 sm:group-hover:opacity-100"
              >
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </motion.button>
          ))}
        </motion.div>
      </div>

      <FeatureModal feature={selectedFeature} onClose={handleCloseModal} />
    </section>
  );
};
