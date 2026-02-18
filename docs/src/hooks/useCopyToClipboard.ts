import { useState } from "react";

interface UseCopyToClipboardReturn {
  copyToClipboard: (text: string) => Promise<boolean>;
  isCopied: boolean;
}

const fallbackCopyToClipboard = (text: string): boolean => {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();

  try {
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    const success = document.execCommand("copy");
    return success;
  } catch {
    return false;
  } finally {
    // Ensure cleanup happens exactly once
    if (textarea.parentNode === document.body) {
      document.body.removeChild(textarea);
    }
  }
};

export const useCopyToClipboard = (): UseCopyToClipboardReturn => {
  const [isCopied, setIsCopied] = useState(false);

  const copyToClipboard = async (text: string): Promise<boolean> => {
    try {
      await navigator.clipboard.writeText(text);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
      return true;
    } catch {
      const success = fallbackCopyToClipboard(text);
      if (success) {
        setIsCopied(true);
        setTimeout(() => setIsCopied(false), 2000);
      }
      return success;
    }
  };

  return { copyToClipboard, isCopied };
};
