import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import {
  animate,
  motion,
  useInView,
  useMotionValue,
  useReducedMotion,
  useTransform,
  useVelocity,
  type MotionValue,
} from "framer-motion";
import { Mail, Send } from "lucide-react";
import { SectionReveal } from "../common/SectionReveal";
import { useI18n } from "../../contexts/I18nContext";

// A tiny fractal-noise tile, soft-light-blended at low opacity over the dark
// testimonial card to give the flat gradient a faint film grain — the kind of
// texture that keeps a large dark surface from looking plasticky.
const GRAIN =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

/**
 * The official Dodo Brands lockup — the colourful pinwheel mark keeps its brand
 * fills, while the "Dodo Brands" wordmark is mapped to `currentColor` so it reads
 * correctly in both light and dark themes. role/aria-label give it an accessible
 * name in place of the text it draws.
 */
const DodoLogo: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    className={className}
    viewBox="0 0 135 36"
    fill="none"
    role="img"
    aria-label="Dodo Brands"
  >
    <path d="M4.81641 25.582v1.9617c0 1.9432 1.38908 3.058 3.06577 3.058H9.03872V25.582H4.81641z" fill="#ff9f6b" />
    <path d="M29.2664 17.7506c0-2.014-.3977-3.8556-1.1229-5.4723C27.1614 11.6162 26.0691 11.0896 24.8942 10.7139 24.986 11.3637 25.0349 12.0381 25.0349 12.731c0 7.6465-5.6848 12.854-13.0861 12.854H9.03906v5.0197H16.1833C23.5816 30.6016 29.2664 25.3941 29.2664 17.7506z" fill="#ff7d11" />
    <path d="M7.88236 5.01967H16.1832c2.9281.0 5.5869.803760000000001 7.7317 2.24191C21.9078 2.7716 17.3918.0 11.9517.0H3.6478C1.97111.0.582031 1.24106.582031 3.18117V22.5238c0 1.9432 1.389079 3.058 3.065769 3.058H4.81353V8.20084C4.81659 6.26072 6.20567 5.01967 7.88236 5.01967z" fill="#fd886d" />
    <path d="M9.03872 13.2129c0-1.9432 1.38908-3.1811 3.06578-3.1811h8.3039c1.5879.0 3.0964.2371 4.4885.6836C24.7225 9.48052 24.389 8.32569 23.9147 7.26633 21.7699 5.8251 19.1111 5.02441 16.183 5.02441H7.88218c-1.67669.0-3.06577 1.24106-3.06577 3.18118V25.5866H9.04178V13.2129H9.03872z" fill="#fe6e42" />
    <path d="M12.1048 10.0294c-1.6767.0-3.06574 1.2411-3.06574 3.1812V25.5812H11.9488c7.4013.0 13.0861-5.2075 13.0861-12.8541C25.0349 12.0342 24.986 11.3598 24.8942 10.71c-1.3922-.4465-2.9006-.6836-4.4885-.6836H12.1048V10.0294z" fill="#f95611" />
    <path d="M28.1466 12.2773C28.8717 13.8941 29.2695 15.7357 29.2695 17.7497c0 7.6465-5.6849 12.854-13.0862 12.854H9.03906v1.3366c0 1.9432 1.38904 3.058 3.06574 3.058h8.3039c7.4013.0 13.0862-5.1398 13.0862-12.5461.0-4.5947-2.0745-7.9761-5.3483-10.1749z" fill="url(#paint0_linear_63628_2204)" />
    <path d="M28.1495 12.2783C27.2224 10.2058 25.7599 8.4997 23.918 7.26172 24.3922 8.32108 24.7257 9.47591 24.9001 10.7108 26.075 11.0896 27.1673 11.6162 28.1495 12.2783z" fill="#ff9f6b" />
    <path d="M82.3268 11.4318H80.0471V3.75309H82.3268C84.842 3.75309 86.304 5.08078 86.304 7.53231s-1.462 3.89949-3.9772 3.89949zM76.3908.209086V14.9758H82.8521C87.3546 14.9758 90.3951 11.9336 90.3951 7.53231 90.3951 2.92458 87.2951.209086 82.8521.209086H76.3908zM99.871 11.667C97.5602 11.667 96.0413 9.95509 96.0413 7.62117 96.0413 5.2585 97.5033 3.54661 99.814 3.54661 102.182 3.54661 103.644 5.2585 103.644 7.62117 103.644 9.95509 102.298 11.667 99.871 11.667zM99.8114.0C95.2805.0 91.945 3.33753 91.945 7.61856 91.945 11.9597 95.221 15.2084 99.8114 15.2084 104.549 15.2084 107.735 11.8708 107.735 7.55844 107.737 3.28003 104.345.0 99.8114.0zM48.9334 11.4318H46.6537V3.75309h2.2797c2.5152.0 3.9772 1.32769 3.9772 3.77922s-1.462 3.89949-3.9772 3.89949zM43 .209086V14.9758h6.4613c4.5025.0 7.543-3.0422 7.543-7.44349.0-4.60773-3.1-7.323224-7.543-7.323224H43zM66.5371 11.667c-2.3108.0-3.8297-1.71191-3.8297-4.04583.0-2.36267 1.462-4.07456 3.7728-4.07456C68.8479 3.54661 70.2814 5.2585 70.2814 7.62117 70.2788 9.95509 68.9643 11.667 66.5371 11.667zM66.4776.0c-4.531.0-7.8664 3.33753-7.8664 7.61856C58.6112 11.9597 61.7991 15.2084 66.4776 15.2084c4.7069.0 7.8948-3.3376 7.8948-7.64996C74.3724 3.28003 71.0111.0 66.4776.0z" fill="currentColor" />
    <path d="M112.97 31.4605H110.397V23.7818H112.97C115.249 23.7818 116.799 25.1095 116.799 27.5611 116.799 30.0126 115.249 31.4605 112.97 31.4605zm-6.229-11.2227V35.0045h6.461C117.705 35.0045 120.745 31.9623 120.745 27.5611 120.745 22.9533 117.645 20.2378 113.202 20.2378h-6.461zM50.7758 31.9022H46.5062V29.0978h4.1532c1.1411.0 1.6949.473100000000002 1.6949 1.448C52.3543 31.3403 51.8575 31.9022 50.7758 31.9022zm27.6903-2.8357 1.8993-4.9318L82.2958 29.0665H78.4661zM65.1915 27.3833H62.0036V23.4865H64.9561C66.506 23.4865 67.2668 24.166 67.2668 25.4049c0 1.2388-.817700000000002 1.9784-2.0753 1.9784zM50.279 23.3375C51.3606 23.3375 51.8859 23.9569 51.8859 24.8142 51.8859 25.6714 51.3606 26.2909 50.2195 26.2909H46.5062V23.3375H50.279zm34.444 11.667h3.7132L82.3553 20.2378H78.5256l-6.112 14.7667h3.7133L77.18 32.3178H83.6413l1.0817 2.6867zm15.352-14.7667v9.4507l-6.0521-9.4507H90.0457V35.0045h3.5089V25.5826L99.607 35.0045h3.977V20.2378h-3.509zM71.0681 25.316c0-3.2199-2.2513-5.0808-5.3513-5.0808H58.4947V35.0019h3.5089V30.4856h2.3107L67.4712 35.0045h4.0937l-3.5684-5.0494C69.9295 28.9776 71.0681 27.2657 71.0681 25.316zM54.0518 27.4722C55.0454 26.7927 55.4853 25.6401 55.4853 24.3725c0-2.5979-1.9588-4.1347-4.8828-4.1347H43V35.0045h7.8069c3.3924.0 5.2037-1.8896 5.2037-4.3411.0-1.4793-.644299999999994-2.6005-1.9588-3.1912zM126.273 24.43c0-.7684.613-1.1813 2.279-1.1813C130.863 23.2487 132.734 23.7792 133.904 24.0746V20.7971C133.055 20.5619 131.039 20 128.816 20c-3.128.0-6.345 1.0637-6.345 4.8142.0 3.6041 3.041 4.1347 5.78899999999999 4.43C130.247 29.4507 130.775 29.9525 130.775 30.6608 130.775 31.3978 130.25 31.9884 128.231 31.9884 125.892 31.9884 123.786 31.3089 122.647 30.896v3.3401C123.524 34.5602 125.688 35.2397 128.143 35.2397 132.617 35.2397 134.576 33.1436 134.576 30.2191 134.576 27.237 132.501 26.2334 129.81 25.8779 127.502 25.5826 126.273 25.3761 126.273 24.43z" fill="currentColor" />
    <defs>
      <linearGradient gradientUnits="userSpaceOnUse" id="paint0_linear_63628_2204" x1="9.03995" x2="33.4939" y1="23.6363" y2="23.6363">
        <stop stopColor="#ffb738" />
        <stop offset="1" stopColor="#fbad18" />
      </linearGradient>
    </defs>
  </svg>
);

interface Stat {
  /** Display string straight from i18n, e.g. "20+" or "1,000+". */
  value: string;
  label: string;
}

// A 0–9 strip with a trailing 0 so the column wraps from 9 back to 0 seamlessly.
const ROLL = Array.from({ length: 11 }, (_, n) => n % 10);

/**
 * One decimal place rendered as a vertical reel, like a real odometer wheel.
 * Only the units wheel spins continuously; every higher wheel rests on its digit
 * and rolls over solely while the wheel below it carries 9 → 0, so the column
 * reads as a coherent, settling number instead of four blurs racing each other.
 *
 * Leading places stay collapsed (zero width + transparent) until the value grows
 * into them — `9 → 10 → 1,000` — so no ghostly leading zeros ever show, and the
 * most-significant digit reveals itself exactly as it rolls in.
 */
const RollingDigit: React.FC<{ source: MotionValue<number>; place: number }> = ({
  source,
  place,
}) => {
  const y = useTransform(source, (v) => {
    let pos: number;
    if (place === 0) {
      // Units roll smoothly the whole way.
      pos = ((v % 10) + 10) % 10;
    } else {
      // Rest on the digit; only roll within the final tenth, as the wheel below
      // wraps past 9 — the moment a real odometer's carry kicks the next wheel.
      const scaled = v / Math.pow(10, place);
      const whole = Math.floor(scaled);
      const frac = scaled - whole;
      const roll = frac > 0.9 ? (frac - 0.9) / 0.1 : 0;
      pos = (((whole + roll) % 10) + 10) % 10;
    }
    return `${-(pos / ROLL.length) * 100}%`;
  });

  // Reveal across the last tenth before this place becomes significant.
  const threshold = Math.pow(10, place);
  const reveal = useTransform(source, [threshold * 0.9, threshold], [0, 1]);
  const width = useTransform(reveal, (r) => `${(r * 0.64).toFixed(3)}em`);

  return (
    <motion.span
      className="relative inline-block h-[1em] overflow-hidden"
      style={place === 0 ? { width: "0.64em" } : { width, opacity: reveal }}
    >
      {/* Fixed-width column so a collapsing place reveals left-to-right rather
          than squashing the glyph. */}
      <motion.span
        className="absolute left-0 top-0 flex w-[0.64em] flex-col"
        style={{ y }}
      >
        {ROLL.map((d, i) => (
          <span key={i} className="flex h-[1em] items-center justify-center">
            {d}
          </span>
        ))}
      </motion.span>
    </motion.span>
  );
};

/**
 * A thousands separator that fades and widens in lock-step with the digit it
 * follows, so the comma is born together with `1,000` rather than hanging beside
 * phantom leading zeros.
 */
const RollingComma: React.FC<{ source: MotionValue<number>; threshold: number }> = ({
  source,
  threshold,
}) => {
  const reveal = useTransform(source, [threshold * 0.9, threshold], [0, 1]);
  const width = useTransform(reveal, (r) => `${(r * 0.26).toFixed(3)}em`);

  return (
    <motion.span
      className="relative inline-block h-[1em] overflow-hidden"
      style={{ width, opacity: reveal }}
      aria-hidden="true"
    >
      <span className="absolute bottom-0 left-0 flex h-[1em] w-[0.26em] items-end justify-center">
        ,
      </span>
    </motion.span>
  );
};

/**
 * Rolls a metric up from zero the first time it scrolls into view, then rests on
 * its exact i18n string — animated as a row of clock-style digit wheels. The
 * trailing "+" is lifted into the brand gradient for a small, on-brand spark.
 * Honours `prefers-reduced-motion` by resting on the final value immediately.
 * A visually-hidden copy keeps the whole value readable to screen readers, since
 * the visible wheels are split across per-digit nodes. Parsing is forgiving:
 * digits drive the wheels, a "+" suffix is preserved, and thousands grouping
 * mirrors the source string.
 */
const CountUp: React.FC<{ value: string; surface?: string; suffixClassName?: string }> = ({
  value,
  // Colour of the surface behind the reel, used for the edge haze so it blends
  // into whatever card it sits on (defaults to the light card token).
  surface = "var(--color-card)",
  suffixClassName = "text-muted-foreground",
}) => {
  const target = Number(value.replace(/[^0-9]/g, "")) || 0;
  const suffix = value.replace(/[\d.,\s]/g, "");
  const grouped = value.includes(",");
  const reduceMotion = useReducedMotion();

  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });
  const source = useMotionValue(reduceMotion ? target : 0);

  // The edge haze is coupled to how fast the reel is actually moving, not a
  // start/stop flag — normalised by the target so both tiles haze alike. As the
  // ease-out decelerates the count to rest, the haze melts away in step with the
  // motion, so there's no perceptible moment where it "switches off".
  const velocity = useVelocity(source);
  const haze = useTransform(
    velocity,
    [Math.max(target, 1) * 0.03, Math.max(target, 1) * 0.5],
    [0, 1],
  );

  useEffect(() => {
    if (!inView || reduceMotion) return;
    const controls = animate(source, target, {
      duration: 1.6,
      ease: [0.22, 1, 0.36, 1],
    });
    return () => controls.stop();
  }, [inView, reduceMotion, target, source]);

  // Most-significant place down to units, weaving in thousands separators that
  // reveal together with the digit to their left.
  const maxPlace = String(target).length - 1;
  const wheels: React.ReactNode[] = [];
  for (let place = maxPlace; place >= 0; place--) {
    if (grouped && place % 3 === 2 && place < maxPlace) {
      wheels.push(
        <RollingComma
          key={`sep-${place}`}
          source={source}
          threshold={Math.pow(10, place + 1)}
        />,
      );
    }
    wheels.push(<RollingDigit key={place} source={source} place={place} />);
  }

  return (
    <span ref={ref}>
      <span className="sr-only">{value}</span>
      <span aria-hidden="true" className="relative inline-flex items-center tabular-nums leading-none">
        {wheels}
        {suffix && <span className={suffixClassName}>{suffix}</span>}
        {/* Soft haze blurring the reel's top & bottom edges, its opacity bound
            to the reel's speed so it fades out exactly as the digits slow. The
            colour follows the host surface so it works on light or dark cards. */}
        <motion.span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-[0.34em]"
          style={{ opacity: haze, backgroundImage: `linear-gradient(to bottom, ${surface}, transparent)` }}
        />
        <motion.span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-[0.34em]"
          style={{ opacity: haze, backgroundImage: `linear-gradient(to top, ${surface}, transparent)` }}
        />
      </span>
    </span>
  );
};

export const TrustedBy: React.FC = () => {
  const { t } = useI18n();

  // The testimonial reads as a quiet claim with a punchy kicker after the em
  // dash ("…pizza chains — thousands of authors, one block model."). Split on the
  // dash so the kicker can lift into the brand gradient; if a translation drops
  // the dash, the whole line just renders as the claim.
  const summary = t("home.trusted.summary");
  const dashIndex = summary.indexOf("—");
  const claim = dashIndex === -1 ? summary : summary.slice(0, dashIndex).trim();
  const kicker = dashIndex === -1 ? "" : summary.slice(dashIndex + 1).trim();

  const stats: Stat[] = [
    {
      value: t("home.trusted.statCountriesValue"),
      label: t("home.trusted.statCountriesLabel"),
    },
    {
      value: t("home.trusted.statStoresValue"),
      label: t("home.trusted.statStoresLabel"),
    },
  ];

  return (
    <section
      className="pb-10 pt-4"
      id="trusted"
      aria-label={t("home.trusted.title")}
      data-blok-testid="trusted-section"
    >
      <div className="mx-auto w-full max-w-6xl px-6">
        <SectionReveal className="max-w-2xl">
          <h2 className="text-4xl font-bold leading-[1.05] tracking-tight text-foreground sm:text-5xl">
            {t("home.trusted.title")}
          </h2>
        </SectionReveal>

        <div className="mt-12 flex flex-col gap-5">
          {/* ── Featured testimonial — a dark, atmospheric hero. Warm near-black
              surface, a soft brand-gradient glow and film grain for depth, the
              quote in white with the kicker glowing in the brand gradient, and
              the proof metrics set off by a hairline rule. ─────────────────── */}
          <SectionReveal delay={0.08}>
            <div
              className="relative overflow-hidden rounded-[2.25rem] p-8 shadow-[0_40px_90px_-40px_rgba(0,0,0,0.55)] ring-1 ring-white/[0.06] sm:p-12 lg:p-14"
              style={{ backgroundImage: "linear-gradient(150deg, #1e1714 0%, #100c0b 72%)" }}
              data-blok-testid="trusted-featured"
            >
              {/* warm brand glow bleeding from the top-right */}
              <span
                aria-hidden="true"
                className="pointer-events-none absolute -right-24 -top-28 h-80 w-80 rounded-full bg-[radial-gradient(circle,rgba(233,78,122,0.24),rgba(230,128,25,0.10)_45%,transparent_70%)] blur-3xl"
              />
              {/* film grain */}
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 opacity-[0.05] mix-blend-soft-light"
                style={{ backgroundImage: GRAIN }}
              />
              {/* oversized closing quote, a near-subliminal watermark */}
              <span
                aria-hidden="true"
                className="pointer-events-none absolute -top-8 right-4 select-none font-display text-[11rem] leading-none text-white/[0.04] sm:text-[14rem]"
              >
                &rdquo;
              </span>

              <div className="relative flex flex-col gap-10 lg:flex-row lg:items-stretch lg:gap-14">
                {/* company · quote · CTA */}
                <div className="flex flex-1 flex-col">
                  <div className="flex flex-col gap-3">
                    <DodoLogo className="h-9 w-auto self-start text-white" />
                    <span className="text-[15px] text-white/55">
                      {t("home.trusted.tagline")}
                    </span>
                  </div>

                  <blockquote className="mt-9 flex-1 sm:mt-11">
                    <p className="max-w-2xl text-balance font-display text-[23px] font-medium leading-[1.4] tracking-tight text-white/80 sm:text-[30px]">
                      {claim}
                      {kicker && (
                        <>
                          {" — "}
                          <span className="font-semibold text-brand-gradient [box-decoration-break:clone] [-webkit-box-decoration-break:clone]">
                            {kicker}
                          </span>
                        </>
                      )}
                    </p>
                  </blockquote>

                  <div className="mt-10">
                    <Link
                      to="/demo"
                      className="group/cta inline-flex items-center gap-2 rounded-full bg-brand-gradient px-6 py-3.5 text-[15px] font-semibold text-white shadow-[0_12px_30px_-10px_color-mix(in_srgb,var(--brand-via)_70%,transparent)] transition-[transform,box-shadow,filter] duration-300 hover:brightness-[1.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:ring-offset-2 focus-visible:ring-offset-[#16100e] active:scale-[0.98]"
                    >
                      {t("home.trusted.cta")}
                      <svg
                        width="17"
                        height="17"
                        viewBox="0 0 24 24"
                        fill="none"
                        aria-hidden="true"
                        className="transition-transform duration-300 group-hover/cta:translate-x-1"
                      >
                        <path d="M5 12h14M12 5l7 7-7 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </Link>
                  </div>
                </div>

                {/* proof metrics, set off by a hairline */}
                <ul
                  className="flex shrink-0 gap-10 border-white/10 sm:gap-14 lg:flex-col lg:justify-center lg:gap-12 lg:border-l lg:pl-14"
                  data-blok-testid="trusted-stats"
                >
                  {stats.map((stat) => (
                    <li key={stat.label} className="flex flex-col gap-1.5">
                      <span className="font-display text-[40px] font-extrabold leading-none tracking-tight text-white sm:text-[52px]">
                        <CountUp value={stat.value} surface="#15100e" suffixClassName="text-white/40" />
                      </span>
                      <span className="text-[14px] text-white/55">{stat.label}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </SectionReveal>

          {/* ── Slim contact bar — copy left, the two channels right; the primary
              action wears Telegram's own blue. ───────────────────────────── */}
          <SectionReveal delay={0.16}>
            <div
              className="flex flex-col gap-5 rounded-[2.25rem] border border-black/[0.06] bg-card p-7 shadow-card dark:border-white/[0.08] sm:flex-row sm:items-center sm:justify-between sm:gap-8 sm:p-8"
              data-blok-testid="trusted-contact"
            >
              <div className="flex flex-col gap-1.5">
                <h3 className="text-pretty text-[19px] font-bold leading-tight tracking-tight text-foreground">
                  {t("home.trusted.contactTitle")}
                </h3>
                <p className="max-w-[52ch] text-pretty text-[15px] leading-relaxed text-muted-foreground">
                  {t("home.trusted.contactLead")}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3 sm:shrink-0">
                {/* Primary channel — Telegram's brand blue. */}
                <a
                  href="https://t.me/jackuait"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-full bg-[linear-gradient(180deg,#2aabee,#229ed9)] px-5 py-3 text-[14px] font-semibold text-white shadow-[0_8px_20px_-8px_rgba(34,158,217,0.55)] transition-[filter,box-shadow] duration-300 hover:shadow-[0_12px_26px_-8px_rgba(34,158,217,0.6)] hover:brightness-[1.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-[0.98]"
                >
                  <Send className="size-4 -translate-x-[0.5px]" strokeWidth={2.2} aria-hidden="true" />
                  {t("home.trusted.contactTelegram")}
                </a>

                {/* Secondary channel — a quiet bordered pill for email. */}
                <a
                  href="mailto:jackuait@gmail.com?subject=Blok%20for%20our%20team"
                  className="inline-flex items-center gap-2 rounded-full border border-black/[0.12] bg-card px-5 py-3 text-[14px] font-semibold text-foreground transition-[border-color,background-color] duration-300 hover:border-foreground/30 hover:bg-foreground/[0.035] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-[0.98] dark:border-white/[0.16] dark:hover:bg-white/[0.05]"
                >
                  <Mail className="size-4 text-muted-foreground" strokeWidth={2.2} aria-hidden="true" />
                  {t("home.trusted.contactEmail")}
                </a>
              </div>
            </div>
          </SectionReveal>
        </div>
      </div>
    </section>
  );
};
