import type { FC } from "react";
import type { ApiMethod } from "./api-data";
import { CodeBlock } from "../common/CodeBlock";
import { ApiMethodDemo } from "./ApiMethodDemo";

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
 * Card component for displaying an API method with optional demo
 * Renders method signature, description, code example, and interactive demo
 */
export const ApiMethodCard: FC<ApiMethodCardProps> = ({ method, sectionId }) => {
  const methodId = generateMethodId(sectionId, method.name);

  return (
    <div
      id={methodId}
      className="api-method-card"
      data-blok-testid="api-method-card"
    >
      <div className="api-method-header">
        <a href={`#${methodId}`} className="api-anchor-link api-anchor-link--method" aria-label={`Link to ${method.name}`}>#</a>
        <span className="api-method-name">{method.name}</span>
        <span className="api-method-return">{method.returnType}</span>
      </div>
      <p className="api-method-description">{method.description}</p>
      {method.example && (
        <CodeBlock code={method.example} language="typescript" />
      )}
      {method.demo && <ApiMethodDemo demo={method.demo} methodName={method.name} />}
    </div>
  );
};
