import { describe, it, expect } from 'vitest';
import georgianDictionary from '../../../../src/components/i18n/locales/ka.json';
import { uploadErrorMessage } from '../../../../src/components/utils/upload-error-message';

const KEYS = { tooLarge: 'tools.image.errorFileTooLarge', generic: 'tools.image.errorUploadFailed' };

// Minimal i18n stub mirroring LightweightI18n.t interpolation of {var} tokens.
const t = (key: string, vars?: Record<string, string | number>): string => {
  const templates: Record<string, string> = {
    'tools.image.errorFileTooLarge': 'Image is too large. {size} exceeds the {max} limit.',
    'tools.image.errorUploadFailed': 'Upload failed',
  };
  const template = templates[key] ?? key;
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (m, name: string) => (vars[name] !== undefined ? String(vars[name]) : m));
};

const georgianT = (key: string): string =>
  (georgianDictionary as Record<string, string>)[key] ?? key;

describe('uploadErrorMessage', () => {
  it('builds a human-readable message for FILE_TOO_LARGE with formatted sizes', () => {
    const msg = uploadErrorMessage(
      { code: 'FILE_TOO_LARGE', detail: '10975799 > 10485760' },
      t,
      KEYS
    );
    expect(msg).toBe('Image is too large. 10 MB exceeds the 10 MB limit.');
  });

  it('formats sub-10 MB sizes with a decimal', () => {
    const msg = uploadErrorMessage(
      { code: 'FILE_TOO_LARGE', detail: `${Math.round(3.5 * 1024 * 1024)} > ${5 * 1024 * 1024}` },
      t,
      KEYS
    );
    expect(msg).toBe('Image is too large. 3.5 MB exceeds the 5.0 MB limit.');
  });

  it.each([
    ['tools.image.errorFileTooLarge', 'სურათი'],
    ['tools.file.errorFileTooLarge', 'ფაილი'],
    ['tools.video.errorFileTooLarge', 'ვიდეო'],
    ['tools.audio.errorFileTooLarge', 'აუდიო'],
  ])('renders caller-safe Georgian size labels for %s', (tooLarge, noun) => {
    const msg = uploadErrorMessage(
      {
        code: 'FILE_TOO_LARGE',
        detail: `${Math.round(3.5 * 1024 * 1024)} > ${5 * 1024 * 1024}`,
      },
      georgianT,
      { tooLarge, generic: 'tools.image.errorUploadFailed' }
    );

    expect(msg).toBe(
      `${noun} ძალიან დიდია. ზომა: 3.5 MB; ლიმიტი: 5.0 MB.`
    );
  });

  it('falls back to the generic message when the detail is unparseable', () => {
    expect(uploadErrorMessage({ code: 'FILE_TOO_LARGE', detail: 'weird' }, t, KEYS)).toBe('Upload failed');
  });

  it('uses the generic message for non-size error codes', () => {
    expect(uploadErrorMessage({ code: 'UNSUPPORTED_TYPE', detail: 'application/pdf' }, t, KEYS)).toBe('Upload failed');
    expect(uploadErrorMessage({ code: 'UPLOAD_FAILED', detail: '500' }, t, KEYS)).toBe('Upload failed');
  });

  it('handles errors with no detail', () => {
    expect(uploadErrorMessage({ code: 'FILE_TOO_LARGE' }, t, KEYS)).toBe('Upload failed');
  });
});
