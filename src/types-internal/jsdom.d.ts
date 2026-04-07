/**
 * Declaration for jsdom (used in CLI for HTML conversion)
 */
declare module 'jsdom' {
  export class JSDOM {
    constructor(html: string);
    window: typeof globalThis;
  }
}
