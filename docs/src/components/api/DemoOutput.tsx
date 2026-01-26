import type { FC } from "react";

export interface DemoOutputProps {
  output?: { message: string; type: "success" | "error" } | null;
}

/**
 * Displays the result of a demo action execution
 * Shows success (green) or error (red) messages with appropriate icons
 */
export const DemoOutput: FC<DemoOutputProps> = ({ output }) => {
  if (!output) {
    return null;
  }

  const isSuccess = output.type === "success";

  return (
    <div
      className={`api-demo-output api-demo-output-${output.type}`}
      data-blok-testid="api-demo-output"
      data-output-type={output.type}
    >
      {isSuccess ? (
        <svg
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
          data-blok-testid="success-icon"
        >
          <path
            d="M11.6666 3.5L5.24992 9.91667L2.33325 7"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : (
        <svg
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
          data-blok-testid="error-icon"
        >
          <path
            d="M7 8.16667V7M7 5.83333V5.83333M11.6667 7C11.6667 9.57733 9.57733 11.6667 7 11.6667C4.42267 11.6667 2.33333 9.57733 2.33333 7C2.33333 4.42267 4.42267 2.33333 7 2.33333C9.57733 2.33333 11.6667 4.42267 11.6667 7Z"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      )}
      <span>{output.message}</span>
    </div>
  );
};
