import { SectionReveal } from "../common/SectionReveal";
import { Typo } from "../common/Typo";
import { useI18n } from "../../contexts/I18nContext";
import { cn } from "@/lib/utils";

/**
 * A single comparison row. `blok` is highlighted as the hero column; the
 * competitor cells are short, neutral, verifiable tokens ("Built-in",
 * "Plugins", "—") describing each library's out-of-the-box default. A `true`
 * value renders a check, otherwise the cell value is looked up in the
 * catalogue: these cells are the page's densest body prose, and leaving them as
 * English literals is what made the Russian home page read as an English one.
 */
interface ComparisonRow {
  /** i18n key suffix under home.whyBlok (e.g. "rowSlash"). */
  labelKey: string;
  /** Each cell is a key suffix under home.whyBlok.cells, or `true` for a check. */
  blok: string | true;
  editorjs: string | true;
  tiptap: string | true;
  lexical: string | true;
}

/** Competitor column order, kept as literal proper nouns (not translated). */
const COMPETITORS = ["Editor.js", "TipTap", "Lexical"] as const;

const ROWS: ComparisonRow[] = [
  {
    labelKey: "rowOutput",
    blok: "typedJson",
    editorjs: "json",
    tiptap: "htmlOrJson",
    lexical: "json",
  },
  {
    labelKey: "rowEverythingBlock",
    blok: true,
    editorjs: "flat",
    tiptap: "nodes",
    lexical: "nodes",
  },
  {
    labelKey: "rowBlocks",
    blok: "builtInCount",
    editorjs: "paragraphOnly",
    tiptap: "basicsOnly",
    lexical: "primitives",
  },
  {
    labelKey: "rowMarkdown",
    blok: "builtIn",
    editorjs: "plugin",
    tiptap: "addOn",
    lexical: "addOn",
  },
  {
    labelKey: "rowTypeScript",
    blok: true,
    editorjs: true,
    tiptap: true,
    lexical: true,
  },
  {
    labelKey: "rowBindings",
    blok: "reactVueAngular",
    editorjs: "community",
    tiptap: "reactVueSvelte",
    lexical: "react",
  },
  {
    labelKey: "rowI18n",
    blok: "locales",
    editorjs: "manual",
    tiptap: "manual",
    lexical: "manual",
  },
  {
    labelKey: "rowA11y",
    blok: "builtIn",
    editorjs: "limited",
    tiptap: "diy",
    lexical: "firstClass",
  },
];

const Check: React.FC = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    className="inline-block"
  >
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const Cell: React.FC<{ valueKey: string | true; emphasize?: boolean }> = ({
  valueKey,
  emphasize,
}) => {
  const { t } = useI18n();

  return valueKey === true ? (
    <span className={emphasize ? "text-primary" : "text-foreground"}>
      <Check />
    </span>
  ) : (
    <span className={cn(emphasize ? "font-semibold text-foreground" : "text-muted-foreground")}>
      {t(`home.whyBlok.cells.${valueKey}`)}
    </span>
  );
};

/**
 * "Why Blok over the alternatives" — a capability matrix that contrasts Blok's
 * batteries-included defaults with the minimal-core-plus-plugins model of
 * Editor.js, TipTap, and Lexical. The Blok column is visually promoted; a
 * disclaimer keeps the comparison fair (every library is extensible).
 */
export const WhyBlok: React.FC = () => {
  const { t } = useI18n();

  return (
    <section
      className="py-16 sm:py-20"
      aria-label={t("home.whyBlok.sectionLabel")}
      data-blok-testid="why-blok-section"
    >
      <div className="mx-auto w-full max-w-6xl px-6">
        <SectionReveal className="max-w-2xl">
          <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            <span className="block"><Typo>{t("home.whyBlok.title1")}</Typo></span>
            <span className="block"><Typo>{t("home.whyBlok.title2")}</Typo></span>
          </h2>
          <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
            <Typo>{t("home.whyBlok.description")}</Typo>
          </p>
        </SectionReveal>

        <SectionReveal className="mt-10 overflow-hidden rounded-3xl border border-black/[0.06] bg-card shadow-card dark:border-white/[0.08]">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-black/[0.06] dark:border-white/[0.08]">
                  <th
                    scope="col"
                    className="sticky left-0 z-20 bg-card px-5 py-4 font-medium text-muted-foreground"
                  >
                    {t("home.whyBlok.colCapability")}
                  </th>
                  <th
                    scope="col"
                    className="bg-primary/[0.06] px-5 py-4 text-center font-bold text-foreground"
                  >
                    Blok
                  </th>
                  {COMPETITORS.map((name) => (
                    <th
                      key={name}
                      scope="col"
                      data-lang-exempt
                      className="px-5 py-4 text-center font-semibold text-muted-foreground"
                    >
                      {name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ROWS.map((row) => (
                  <tr
                    key={row.labelKey}
                    className="border-b border-black/[0.04] last:border-0 dark:border-white/[0.06]"
                  >
                    <th
                      scope="row"
                      className="sticky left-0 z-10 bg-card px-5 py-4 font-medium text-foreground"
                    >
                      <Typo>{t(`home.whyBlok.${row.labelKey}`)}</Typo>
                    </th>
                    <td className="bg-primary/[0.06] px-5 py-4 text-center">
                      <Cell valueKey={row.blok} emphasize />
                    </td>
                    <td className="px-5 py-4 text-center">
                      <Cell valueKey={row.editorjs} />
                    </td>
                    <td className="px-5 py-4 text-center">
                      <Cell valueKey={row.tiptap} />
                    </td>
                    <td className="px-5 py-4 text-center">
                      <Cell valueKey={row.lexical} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionReveal>
      </div>
    </section>
  );
};
