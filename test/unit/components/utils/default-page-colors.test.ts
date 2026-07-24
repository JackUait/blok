import { describe, it, expect } from 'vitest';
import {
  isDefaultDarkBackground,
  isDefaultWhiteBackground,
  isInvisibleBackground,
} from '../../../../src/components/utils/default-page-colors';

describe('default-page-colors', () => {
  describe('isDefaultWhiteBackground', () => {
    it.each(['#fff', '#ffffff', 'rgb(255,255,255)', 'rgb(255, 255, 255)', 'white'])(
      'matches exact white %s',
      (value) => {
        expect(isDefaultWhiteBackground(value)).toBe(true);
      }
    );

    it('does not match near-white', () => {
      expect(isDefaultWhiteBackground('#fefefe')).toBe(false);
    });
  });

  describe('isInvisibleBackground', () => {
    it.each(['transparent', 'rgba(255,255,255,0)', 'rgba(0,0,0,0)', 'rgba(120, 34, 200, 0)'])(
      'treats transparent/zero-alpha %s as invisible',
      (value) => {
        expect(isInvisibleBackground(value)).toBe(true);
      }
    );

    it.each(['#fff', '#ffffff', 'rgb(255,255,255)', 'white'])('treats exact white %s as invisible', (value) => {
      expect(isInvisibleBackground(value)).toBe(true);
    });

    it.each(['#fefefe', '#fafafa', 'rgb(250,250,250)', 'rgb(252, 253, 251)'])(
      'treats near-white %s as invisible',
      (value) => {
        expect(isInvisibleBackground(value)).toBe(true);
      }
    );

    it.each(['#191918', 'rgb(25,25,24)'])('treats near-black page bg %s as invisible', (value) => {
      expect(isInvisibleBackground(value)).toBe(true);
    });

    it.each([
      '#f1f1ef', // Blok's gray highlight preset — luminance ~0.94 but a real highlight
      'rgb(241,241,239)',
      '#f5f5f5', // whitesmoke — below the near-white channel floor, kept
      '#fbecdd', // pale peach highlight
      '#fffde7', // pale yellow highlight
      'yellow',
      '#ffeb3b',
      'rgb(255,235,59)',
      'rgb(120,34,200)',
    ])('keeps genuine highlight %s (not invisible)', (value) => {
      expect(isInvisibleBackground(value)).toBe(false);
    });

    it('keeps a semi-transparent non-zero-alpha color', () => {
      expect(isInvisibleBackground('rgba(120,34,200,0.5)')).toBe(false);
    });

    it('is consistent with the dark-bg predicate', () => {
      expect(isInvisibleBackground('#191918')).toBe(isDefaultDarkBackground('#191918'));
    });
  });
});
