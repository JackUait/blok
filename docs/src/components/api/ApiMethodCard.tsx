import type { FC } from "react";
import type { ApiMethod } from "./api-data";
import { CodeBlock } from "../common/CodeBlock";
import { generateMethodId } from "./api-anchors";
import { useI18n } from "../../contexts/I18nContext";
import { Typo } from "../common/Typo";
import { renderInline } from "./inline-code";

export interface ApiMethodCardProps {
  method: ApiMethod;
  sectionId: string;
}

/**
 * Card component for displaying an API method
 * Renders method signature, description, a "when to use" note, and code example
 */
export const ApiMethodCard: FC<ApiMethodCardProps> = ({ method, sectionId }) => {
  const { t } = useI18n();
  const methodId = generateMethodId(sectionId, method.name);

  return (
    <div
      id={methodId}
      className="scroll-mt-24 rounded-2xl border border-border bg-card p-5 shadow-sm"
      data-blok-testid="api-method-card"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm font-semibold tracking-tight text-foreground">{method.name}</span>
        <span className="rounded-md bg-secondary px-2 py-0.5 font-mono text-xs text-muted-foreground">{method.returnType}</span>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground"><Typo>{method.description}</Typo></p>
      {method.note && (
        <div
          className="mt-4 rounded-xl border border-border bg-secondary/40 px-4 py-3"
          data-blok-testid="api-method-note"
        >
          <p className="font-display text-[0.6875rem] font-bold uppercase tracking-wide text-muted-foreground">
            <Typo>{t("api.whenToUse")}</Typo>
          </p>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            {renderInline(method.note)}
          </p>
        </div>
      )}
      {method.example && (
        <div className="mt-4">
          <CodeBlock code={method.example} language="typescript" />
        </div>
      )}
    </div>
  );
};
