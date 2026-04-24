import { describe, it, expect } from 'vitest';
import { dimensionsFromUrl } from '../../../../src/tools/image/dimensions-from-url';

describe('dimensionsFromUrl', () => {
  describe('generic query params', () => {
    it('parses ?w=&h=', () => {
      expect(dimensionsFromUrl('https://cdn.example.com/pic.jpg?w=400&h=300')).toEqual({ width: 400, height: 300 });
    });
    it('parses ?width=&height=', () => {
      expect(dimensionsFromUrl('https://cdn.example.com/pic.jpg?width=800&height=600')).toEqual({ width: 800, height: 600 });
    });
    it('parses ?size=WxH', () => {
      expect(dimensionsFromUrl('https://cdn.example.com/pic.jpg?size=1024x768')).toEqual({ width: 1024, height: 768 });
    });
    it('returns null when only width is present', () => {
      expect(dimensionsFromUrl('https://cdn.example.com/pic.jpg?w=400')).toBeNull();
    });
  });

  describe('CDN-specific patterns', () => {
    it('parses Cloudinary w_/h_ path segment', () => {
      expect(dimensionsFromUrl('https://res.cloudinary.com/demo/image/upload/w_400,h_300,c_fill/sample.jpg')).toEqual({ width: 400, height: 300 });
    });
    it('parses Cloudinary chained transforms across separate segments', () => {
      expect(dimensionsFromUrl('https://res.cloudinary.com/demo/image/upload/w_400/h_300/c_fill/sample.jpg')).toEqual({ width: 400, height: 300 });
    });
    it('parses Cloudflare Images /cdn-cgi/image/width=,height=/', () => {
      expect(dimensionsFromUrl('https://site.com/cdn-cgi/image/width=400,height=300,fit=cover/https://img.jpg')).toEqual({ width: 400, height: 300 });
    });
    it('parses ImageKit tr:w-,h- path', () => {
      expect(dimensionsFromUrl('https://ik.imagekit.io/demo/tr:w-400,h-300/pic.jpg')).toEqual({ width: 400, height: 300 });
    });
    it('parses WordPress Photon ?resize=W,H', () => {
      expect(dimensionsFromUrl('https://i0.wp.com/site.com/img.jpg?resize=400,300')).toEqual({ width: 400, height: 300 });
    });
    it('parses Akamai imwidth/imheight', () => {
      expect(dimensionsFromUrl('https://cdn.example.com/pic.jpg?imwidth=640&imheight=480')).toEqual({ width: 640, height: 480 });
    });
  });

  describe('filename patterns', () => {
    it('parses -WIDTHxHEIGHT suffix', () => {
      expect(dimensionsFromUrl('https://cdn.example.com/photo-1920x1080.jpg')).toEqual({ width: 1920, height: 1080 });
    });
    it('parses _WIDTHxHEIGHT suffix', () => {
      expect(dimensionsFromUrl('https://cdn.example.com/pic_800x600_crop.png')).toEqual({ width: 800, height: 600 });
    });
    it('parses _wN_hN suffix', () => {
      expect(dimensionsFromUrl('https://cdn.example.com/foo_w400_h300.jpg')).toEqual({ width: 400, height: 300 });
    });
  });

  describe('priority and fallbacks', () => {
    it('query params win over filename', () => {
      expect(dimensionsFromUrl('https://cdn.example.com/photo-1920x1080.jpg?w=400&h=300')).toEqual({ width: 400, height: 300 });
    });
    it('returns null for bare URL without hints', () => {
      expect(dimensionsFromUrl('https://cdn.example.com/picture.jpg')).toBeNull();
    });
    it('returns null for empty string', () => {
      expect(dimensionsFromUrl('')).toBeNull();
    });
    it('returns null for invalid URL', () => {
      expect(dimensionsFromUrl('not a url')).toBeNull();
    });
    it('rejects zero or negative dims', () => {
      expect(dimensionsFromUrl('https://cdn.example.com/pic.jpg?w=0&h=300')).toBeNull();
    });
  });
});
