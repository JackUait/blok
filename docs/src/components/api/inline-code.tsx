import { Fragment } from "react";

const codeClass =
  "rounded-md bg-secondary px-1.5 py-0.5 font-mono text-[0.8125rem] text-foreground";

/**
 * Render a translated string that may contain `inline code` spans (delimited by
 * backticks) as React nodes, so prose copy can reference API names without
 * embedding markup in the translation files.
 */
export const renderInline = (text: string): React.ReactNode =>
  text.split(/(`[^`]+`)/g).map((part, index) =>
    part.startsWith("`") && part.endsWith("`") ? (
      <code key={index} className={codeClass}>
        {part.slice(1, -1)}
      </code>
    ) : (
      <Fragment key={index}>{part}</Fragment>
    ),
  );
