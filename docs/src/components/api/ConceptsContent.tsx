import { Fragment } from "react";
import { CodeBlock } from "../common/CodeBlock";
import { Typo } from "../common/Typo";
import { useI18n } from "../../contexts/I18nContext";

const headingClass =
  "font-display text-lg font-bold tracking-tight text-foreground";
const proseClass = "text-base leading-relaxed text-muted-foreground";
const codeClass =
  "rounded-md bg-secondary px-1.5 py-0.5 font-mono text-[0.8125rem] text-foreground";
const thClass =
  "border-b border-border px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-muted-foreground";
const tdClass = "px-4 py-3 align-top text-sm text-muted-foreground";

/**
 * Render a translated string that may contain `inline code` spans (delimited by
 * backticks) as React nodes, so concept copy can reference API names without
 * embedding markup in the translation files.
 */
const renderInline = (text: string): React.ReactNode =>
  text.split(/(`[^`]+`)/g).map((part, index) =>
    part.startsWith("`") && part.endsWith("`") ? (
      <code key={index} className={codeClass}>
        {part.slice(1, -1)}
      </code>
    ) : (
      <Fragment key={index}>{part}</Fragment>
    ),
  );

const BLOCK_SHAPE_CODE = `// Every block — whatever its type — is the same small object
{
  id: 'block-a1b2c3',              // unique, auto-generated
  type: 'paragraph',              // which tool renders it
  data: { text: 'Hello, world' }, // the tool's content
  tunes: {},                      // block-level settings (optional)
}`;

const BLOCK_TREE_CODE = `// A database block holds its rows as children
{
  id: 'db-1',
  type: 'database',
  data: { schema: [/* columns */], views: [/* configs */] },
  contentIds: ['row-1', 'row-2'], // its children
}

// A row is a block that points back to its parent
{
  id: 'row-1',
  type: 'database-row',
  parentId: 'db-1',
  data: { properties: { status: 'Done', priority: 'High' } },
}`;

export const ConceptsContent: React.FC = () => {
  const { t } = useI18n();

  const exampleRows = ["paragraph", "database", "row", "page"] as const;
  const whyItems = ["operations", "serialization", "nesting"] as const;
  const decisionExamples = ["calendar", "comments", "toc", "embed"] as const;

  return (
    <div className="flex flex-col gap-12">
      <p className="max-w-2xl text-lg leading-relaxed text-foreground/90">
        {renderInline(t("api.concepts.lead"))}
      </p>

      {/* The shape of a block */}
      <div className="flex flex-col gap-4">
        <h2 className={headingClass}><Typo>{t("api.concepts.shape.title")}</Typo></h2>
        <p className={proseClass}>{renderInline(t("api.concepts.shape.body"))}</p>
        <CodeBlock code={BLOCK_SHAPE_CODE} language="typescript" />
      </div>

      {/* Blocks form a tree */}
      <div className="flex flex-col gap-4">
        <h2 className={headingClass}><Typo>{t("api.concepts.tree.title")}</Typo></h2>
        <p className={proseClass}>{renderInline(t("api.concepts.tree.body"))}</p>
        <CodeBlock code={BLOCK_TREE_CODE} language="typescript" />
      </div>

      {/* The same idea, all the way up */}
      <div className="flex flex-col gap-4">
        <h2 className={headingClass}><Typo>{t("api.concepts.everywhere.title")}</Typo></h2>
        <p className={proseClass}>
          {renderInline(t("api.concepts.everywhere.body"))}
        </p>
        <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-sm">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className={thClass}>
                  {t("api.concepts.everywhere.thingHeader")}
                </th>
                <th className={thClass}>
                  <Typo>{t("api.concepts.everywhere.whyHeader")}</Typo>
                </th>
              </tr>
            </thead>
            <tbody>
              {exampleRows.map((row) => (
                <tr key={row} className="border-t border-border">
                  <td className={`${tdClass} whitespace-nowrap font-medium text-foreground`}>
                    <Typo>{t(`api.concepts.everywhere.rows.${row}.thing`)}</Typo>
                  </td>
                  <td className={tdClass}>
                    {renderInline(t(`api.concepts.everywhere.rows.${row}.why`))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* What is not a block */}
      <div className="flex flex-col gap-4">
        <h2 className={headingClass}><Typo>{t("api.concepts.notBlocks.title")}</Typo></h2>
        <p className={proseClass}>
          {renderInline(t("api.concepts.notBlocks.body"))}
        </p>
      </div>

      {/* Why this matters to you */}
      <div className="flex flex-col gap-4">
        <h2 className={headingClass}><Typo>{t("api.concepts.why.title")}</Typo></h2>
        <p className={proseClass}>{renderInline(t("api.concepts.why.body"))}</p>
        <div className="flex flex-col gap-3">
          {whyItems.map((item) => (
            <div
              key={item}
              className="rounded-xl border border-border bg-card px-5 py-4 shadow-sm"
            >
              <p className="font-display text-sm font-bold tracking-tight text-foreground">
                <Typo>{t(`api.concepts.why.items.${item}.label`)}</Typo>
              </p>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                {renderInline(t(`api.concepts.why.items.${item}.text`))}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Extending Blok? Ask one question */}
      <div className="flex flex-col gap-4 rounded-2xl border border-primary/20 bg-primary/[0.04] px-6 py-6">
        <h2 className={headingClass}><Typo>{t("api.concepts.decision.title")}</Typo></h2>
        <p className={proseClass}>
          {renderInline(t("api.concepts.decision.body"))}
        </p>
        <ul className="flex flex-col gap-2">
          {decisionExamples.map((example) => (
            <li
              key={example}
              className="flex gap-2.5 text-sm leading-relaxed text-muted-foreground"
            >
              <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-primary/60" />
              <span>{renderInline(t(`api.concepts.decision.examples.${example}`))}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Where to go next */}
      <p className="text-base leading-relaxed text-muted-foreground">
        {t("api.concepts.next.intro")} {t("api.concepts.next.blocksPrefix")}{" "}
        <a href="#blocks-api" className="font-medium text-primary hover:underline">
          {t("api.concepts.next.blocksLink")}
        </a>{" "}
        {t("api.concepts.next.blocksSuffix")}{" "}
        <a href="#block-data" className="font-medium text-primary hover:underline">
          {t("api.concepts.next.blockDataLink")}
        </a>{" "}
        {t("api.concepts.next.blockDataSuffix")}
      </p>
    </div>
  );
};
