import { safeDownloadHref } from '../../components/utils/sanitize-url';

/**
 * Saves a file through a same-origin object URL, where `download` is honored.
 * The anchor goes on the body: inside the editor, Blok's own click handling
 * takes the click and no download starts.
 */
export const downloadBlob = (blob: Blob, fileName: string): void => {
  const url = URL.createObjectURL(blob);
  const href = safeDownloadHref(url);

  if (href !== null) {
    const a = document.createElement('a');

    a.href = href;
    a.download = fileName;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  URL.revokeObjectURL(url);
};
