import { useState } from 'react';
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard';

interface CodeBlockProps {
  code: string;
  language?: string;
  copyLabel?: string;
}

export const CodeBlock: React.FC<CodeBlockProps> = ({
  code,
  language = 'bash',
  copyLabel = 'Copy',
}) => {
  const { copyToClipboard } = useCopyToClipboard();
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const success = await copyToClipboard(code);
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="code-block" data-code-block>
      <button
        className={`code-copy ${copied ? 'copied' : ''}`}
        data-copy
        data-code={code}
        onClick={handleCopy}
        type="button"
      >
        <span className="code-copy-text">{copied ? 'Copied!' : copyLabel}</span>
        <svg
          className="code-copy-icon"
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="currentColor"
        >
          <path d="M5 3v8a2 2 0 002 2h6V11H7a1 1 0 01-1-1V3H5zm2-1h6a2 2 0 012 2v9a2 2 0 01-2 2H7a2 2 0 01-2-2V2z" />
        </svg>
      </button>
      <pre>
        <code className={`language-${language}`}>{code}</code>
      </pre>
    </div>
  );
};
