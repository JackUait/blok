import type { FC } from "react";
import type { ApiMethod } from "./api-data";
import { ApiMethodDemo } from "./ApiMethodDemo";
import { CodeBlock } from "../common/CodeBlock";

export interface ApiMethodCardProps {
  method: ApiMethod;
}

/**
 * Card component for displaying an API method with optional demo
 * Renders method signature, description, code example, and interactive demo
 */
export const ApiMethodCard: FC<ApiMethodCardProps> = ({ method }) => {
  const hasDemo = Boolean(method.demo);

  return (
    <div
      className={`api-method-card${hasDemo ? " api-method-card--with-demo" : ""}`}
      data-testid="api-method-card"
      data-has-demo={hasDemo}
    >
      <div className="api-method-header">
        <span className="api-method-name">{method.name}</span>
        <span className="api-method-return">{method.returnType}</span>
      </div>
      <p className="api-method-description">{method.description}</p>
      {method.example && (
        <CodeBlock code={method.example} language="typescript" />
      )}
      <ApiMethodDemo demo={method.demo} />
    </div>
  );
};
