import { useState } from "react";
import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";

interface OutputPanelProps {
  output: string;
}

export const OutputPanel: React.FC<OutputPanelProps> = ({ output }) => {
  const { copyToClipboard } = useCopyToClipboard();
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const isValidOutput =
      output && output !== 'Click "Save" to see the JSON output';
    if (!isValidOutput) {
      return;
    }

    const success = await copyToClipboard(output);
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div
      className="output-panel"
      id="output-panel"
      data-blok-testid="output-panel"
    >
      <div className="output-header" data-blok-testid="output-header">
        <div className="output-title" data-blok-testid="output-title">
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M2 3v10a2 2 0 002 2h8a2 2 0 002-2V5l-2-2H4a2 2 0 00-2 2z"
              stroke="currentColor"
              strokeWidth="1.5"
            />
            <path
              d="M6 9l2 2 4-4"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span>JSON Output</span>
        </div>
        <button
          className={`output-copy ${copied ? "copied" : ""}`}
          onClick={handleCopy}
          type="button"
          data-blok-testid="output-copy"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M5 3v8a2 2 0 002 2h6V11H7a1 1 0 01-1-1V3H5zm2-1h6a2 2 0 012 2v9a2 2 0 01-2 2H7a2 2 0 01-2-2V2z" />
          </svg>
          <span className="copy-text">{copied ? "Copied!" : "Copy"}</span>
        </button>
      </div>
      <pre
        className="output-content"
        id="output-content"
        data-blok-testid="output-content"
      >
        {output}
      </pre>
    </div>
  );
};
