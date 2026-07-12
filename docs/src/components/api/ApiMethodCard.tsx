import type { FC } from "react";
import type { ApiMethod } from "./api-data";
import { CodeBlock } from "../common/CodeBlock";
import { generateMethodId } from "./api-anchors";
import { useI18n } from "../../contexts/I18nContext";
import { useFramework } from "../../contexts/FrameworkContext";
import { adaptExample } from "../common/framework-adapt";
import { Typo } from "../common/Typo";
import { renderInline } from "./inline-code";
import { Badge } from "../ui/badge";

export interface ApiMethodCardProps {
  method: ApiMethod;
  sectionId: string;
}

const thClass =
  "border-b border-border px-3 py-2 text-left text-xs font-bold uppercase tracking-wide text-muted-foreground";
const tdClass = "px-3 py-2 align-top text-sm text-muted-foreground";
const codeClass =
  "rounded-md bg-secondary px-1.5 py-0.5 font-mono text-[0.8125rem] text-foreground";

/**
 * Card component for displaying an API method
 * Renders method signature, description, a "when to use" note, parameter
 * table, error list, deprecation badge, and code example
 */
export const ApiMethodCard: FC<ApiMethodCardProps> = ({ method, sectionId }) => {
  const { t } = useI18n();
  const { framework } = useFramework();
  const methodId = generateMethodId(sectionId, method.name);
  const example = method.example ? adaptExample(method.example, framework) : null;

  return (
    <div
      id={methodId}
      className="scroll-mt-24 border-t border-border pt-8"
      data-blok-testid="api-method-card"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-mono text-sm font-semibold tracking-tight text-foreground">{method.name}</h3>
        <span className="rounded-md bg-secondary px-2 py-0.5 font-mono text-xs text-muted-foreground">{method.returnType}</span>
        {(method.deprecated || method.deprecatedSince) && (
          <Badge variant="muted" className="uppercase" data-blok-testid="api-method-deprecated-badge">
            <Typo>{t("api.deprecated")}</Typo>
          </Badge>
        )}
      </div>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground"><Typo>{method.description}</Typo></p>
      {(method.deprecated || method.deprecatedSince) && (
        <p className="mt-1 text-xs text-muted-foreground" data-blok-testid="api-method-deprecated">
          {method.deprecatedSince && (
            <>
              <Typo>{t("api.deprecatedSince")}</Typo> v{method.deprecatedSince}
              {method.replacedBy && " — "}
            </>
          )}
          {method.replacedBy && (
            <>
              <Typo>{t("api.useInstead")}</Typo>{" "}
              <a
                href={`#${generateMethodId(sectionId, method.replacedBy)}`}
                className="font-mono text-primary underline-offset-4 hover:underline"
              >
                {method.replacedBy}
              </a>
            </>
          )}
        </p>
      )}
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
      {method.params && method.params.length > 0 && (
        <div className="mt-4" data-blok-testid="api-method-params">
          <p className="font-display text-[0.6875rem] font-bold uppercase tracking-wide text-muted-foreground">
            <Typo>{t("api.parameters")}</Typo>
          </p>
          <div className="mt-2 overflow-x-auto rounded-xl border border-border">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className={thClass}>{t("api.parameter")}</th>
                  <th className={thClass}>{t("api.type")}</th>
                  <th className={thClass}>{t("api.required")}</th>
                  <th className={thClass}>{t("api.default")}</th>
                  <th className={thClass}>{t("api.description")}</th>
                </tr>
              </thead>
              <tbody>
                {method.params.map((param) => (
                  <tr key={param.name} className="border-t border-border">
                    <td className={tdClass}>
                      <code className={codeClass}>{param.name}</code>
                    </td>
                    <td className={tdClass}>
                      <code className={codeClass}>{param.type}</code>
                    </td>
                    <td className={tdClass}>{param.required ? t("api.required") : "—"}</td>
                    <td className={tdClass}>
                      {param.default ? <code className={codeClass}>{param.default}</code> : "—"}
                    </td>
                    <td className={tdClass}>{renderInline(param.description)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {method.errors && method.errors.length > 0 && (
        <div className="mt-4" data-blok-testid="api-method-errors">
          <p className="font-display text-[0.6875rem] font-bold uppercase tracking-wide text-muted-foreground">
            <Typo>{t("api.errors")}</Typo>
          </p>
          <ul className="mt-2 flex flex-col gap-3">
            {method.errors.map((error, index) => (
              <li key={index} className="rounded-xl border border-border px-4 py-3">
                <p className="text-sm font-semibold text-foreground">{renderInline(error.condition)}</p>
                <p className="mt-1 break-all font-mono text-xs text-muted-foreground">{error.message}</p>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{renderInline(error.resolution)}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
      {example && (
        <div className="mt-4">
          <CodeBlock code={example.code} language={example.language} />
        </div>
      )}
    </div>
  );
};
