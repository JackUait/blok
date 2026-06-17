import type { FC } from "react";
import type { ApiMethod } from "./api-data";
import { CodeBlock } from "../common/CodeBlock";

export interface ApiMethodCardProps {
  method: ApiMethod;
  sectionId: string;
}

/**
 * Generate a URL-safe anchor ID from a method name
 * e.g., "blocks.clear()" -> "blocks-clear"
 * e.g., "blocks.move(toIndex, fromIndex?)" -> "blocks-move"
 */
const generateMethodId = (sectionId: string, methodName: string): string => {
  // Extract just the method name without parameters
  const methodBase = methodName.split('(')[0];
  const cleanName = methodBase
    .replace(/[.]+/g, "-") // Replace dots with dashes
    .replace(/-+/g, "-") // Collapse multiple dashes
    .replace(/-$/, "") // Remove trailing dash
    .toLowerCase();
  return `${sectionId}-${cleanName}`;
};

/**
 * Card component for displaying an API method
 * Renders method signature, description, and code example
 */
export const ApiMethodCard: FC<ApiMethodCardProps> = ({ method, sectionId }) => {
  const methodId = generateMethodId(sectionId, method.name);

  return (
    <div
      id={methodId}
      className="group scroll-mt-24 rounded-2xl border border-border bg-card p-5 shadow-sm transition-shadow hover:shadow-card-hover"
      data-blok-testid="api-method-card"
    >
      <div className="flex flex-wrap items-center gap-2">
        <a
          href={`#${methodId}`}
          className="api-anchor-link api-anchor-link--method -ml-5 w-5 shrink-0 text-center text-muted-foreground opacity-0 transition-opacity hover:text-primary group-hover:opacity-100"
          aria-label={`Link to ${method.name}`}
        >
          #
        </a>
        <span className="font-mono text-sm font-semibold tracking-tight text-foreground">{method.name}</span>
        <span className="rounded-md bg-secondary px-2 py-0.5 font-mono text-xs text-muted-foreground">{method.returnType}</span>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{method.description}</p>
      {method.example && (
        <div className="mt-4">
          <CodeBlock code={method.example} language="typescript" />
        </div>
      )}
    </div>
  );
};
