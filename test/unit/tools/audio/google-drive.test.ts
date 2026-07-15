import { describe, it, expect } from 'vitest';
import { googleDriveDirectDownloadUrl } from '../../../../src/tools/audio/google-drive';

const ID = '1kEpLxTdbrbEFMCUNSIrMkxCixC20ELrM';
const DIRECT = `https://drive.usercontent.google.com/download?id=${ID}&export=download&confirm=t`;

describe('googleDriveDirectDownloadUrl', () => {
  it('normalizes a /file/d/<id>/view share link', () => {
    expect(googleDriveDirectDownloadUrl(`https://drive.google.com/file/d/${ID}/view?usp=drive_link`))
      .toBe(DIRECT);
  });

  it('normalizes a /file/d/<id> link without a /view suffix', () => {
    expect(googleDriveDirectDownloadUrl(`https://drive.google.com/file/d/${ID}`)).toBe(DIRECT);
  });

  it('normalizes an open?id=<id> link', () => {
    expect(googleDriveDirectDownloadUrl(`https://drive.google.com/open?id=${ID}`)).toBe(DIRECT);
  });

  it('returns null for non-Drive URLs', () => {
    expect(googleDriveDirectDownloadUrl('https://example.com/song.mp3')).toBeNull();
  });

  it('returns null for Drive folder links', () => {
    expect(googleDriveDirectDownloadUrl(`https://drive.google.com/drive/folders/${ID}`)).toBeNull();
  });

  it('returns null for a lookalike host', () => {
    expect(googleDriveDirectDownloadUrl(`https://drive.google.com.evil.example/file/d/${ID}/view`)).toBeNull();
  });

  it('returns null for unparseable input', () => {
    expect(googleDriveDirectDownloadUrl('not a url')).toBeNull();
  });
});
