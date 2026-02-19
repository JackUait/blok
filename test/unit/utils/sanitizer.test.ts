import { describe, it, expect } from 'vitest';
import { sanitizeBlocks, clean, composeSanitizerConfig } from '../../../src/components/utils/sanitizer';
import type { SanitizerConfig, SanitizerRule } from '../../../types';
import type { SavedData } from '../../../types/data-formats';

/**
 * Unit tests for sanitizer.ts
 *
 * Tests edge cases and internal functionality not covered by E2E tests
 */
describe('sanitizer', () => {
  describe('sanitizeBlocks', () => {
    describe('function-based sanitizeConfig parameter', () => {
      it('should use function to get config per tool', () => {
        const blocksData: Array<Pick<SavedData, 'data' | 'tool'>> = [
          {
            tool: 'paragraph',
            data: {
              text: '<strong>Bold</strong> <span>bad</span>',
            },
          },
          {
            tool: 'header',
            data: {
              text: '<strong>Bold</strong> <span>bad</span>',
            },
          },
        ];

        const getConfig = (toolName: string): SanitizerConfig | undefined => {
          if (toolName === 'paragraph') {
            return {
              strong: {},
            };
          }

          if (toolName === 'header') {
            return {
              span: {},
            };
          }

          return undefined;
        };

        const result = sanitizeBlocks(blocksData, getConfig, {});

        expect(result[0].data.text).toContain('<strong>');
        expect(result[0].data.text).not.toContain('<span>');
        expect(result[1].data.text).not.toContain('<strong>');
        expect(result[1].data.text).toContain('<span>');
      });

      it('should handle function returning undefined', () => {
        const blocksData: Array<Pick<SavedData, 'data' | 'tool'>> = [
          {
            tool: 'paragraph',
            data: {
              text: '<strong>Bold</strong>',
            },
          },
        ];

        const getConfig = (): SanitizerConfig | undefined => undefined;

        const result = sanitizeBlocks(blocksData, getConfig, {});

        // Should return block unchanged when both config and globalSanitizer are empty
        expect(result[0].data.text).toBe('<strong>Bold</strong>');
      });

      it('should use globalSanitizer when function returns undefined', () => {
        const blocksData: Array<Pick<SavedData, 'data' | 'tool'>> = [
          {
            tool: 'paragraph',
            data: {
              text: '<strong>Bold</strong> <span>bad</span>',
            },
          },
        ];

        const getConfig = (): SanitizerConfig | undefined => undefined;
        const globalSanitizer: SanitizerConfig = {
          strong: {},
        };

        const result = sanitizeBlocks(blocksData, getConfig, globalSanitizer);

        expect(result[0].data.text).toContain('<strong>');
        expect(result[0].data.text).not.toContain('<span>');
      });
    });

    describe('early return path', () => {
      it('should return block unchanged when both rules and globalSanitizer are empty', () => {
        const blocksData: Array<Pick<SavedData, 'data' | 'tool'>> = [
          {
            tool: 'paragraph',
            data: {
              text: '<strong>Bold</strong>',
            },
          },
        ];

        const result = sanitizeBlocks(blocksData, {}, {});

        expect(result[0].data.text).toBe('<strong>Bold</strong>');
        expect(result[0].tool).toBe('paragraph');
      });

      it('should sanitize when globalSanitizer is provided even if rules are empty', () => {
        const blocksData: Array<Pick<SavedData, 'data' | 'tool'>> = [
          {
            tool: 'paragraph',
            data: {
              text: '<strong>Bold</strong> <span>bad</span>',
            },
          },
        ];

        const globalSanitizer: SanitizerConfig = {
          strong: {},
        };

        const result = sanitizeBlocks(blocksData, {}, globalSanitizer);

        expect(result[0].data.text).toContain('<strong>');
        expect(result[0].data.text).not.toContain('<span>');
      });
    });

    describe('deep sanitization', () => {
      it('should sanitize nested objects with field-specific rules', () => {
        const blocksData: Array<Pick<SavedData, 'data' | 'tool'>> = [
          {
            tool: 'custom',
            data: {
              title: '<strong>Title</strong> <span>bad</span>',
              content: {
                text: '<strong>Content</strong> <span>bad</span>',
                items: [ '<strong>Item</strong> <span>bad</span>' ],
              },
            },
          },
        ];

        const sanitizeConfig = {
          title: {
            strong: true,
          },
          content: {
            text: {
              strong: true,
            },
            items: {
              strong: true,
            },
          },
        } as unknown as SanitizerConfig;

        const result = sanitizeBlocks(blocksData, sanitizeConfig, {});

        const data = result[0].data;

        expect(data.title).toContain('<strong>');
        expect(data.title).not.toContain('<span>');

        const content = data.content as Record<string, unknown>;

        expect(content.text).toContain('<strong>');
        expect(content.text).not.toContain('<span>');

        const items = content.items as string[];

        expect(items[0]).toContain('<strong>');
        expect(items[0]).not.toContain('<span>');
      });

      it('should handle arrays with primitive values', () => {
        const blocksData: Array<Pick<SavedData, 'data' | 'tool'>> = [
          {
            tool: 'custom',
            data: {
              items: [
                '<strong>Item 1</strong>',
                '<span>Item 2</span>',
                '<i>Item 3</i>',
              ],
            },
          },
        ];

        const sanitizeConfig: SanitizerConfig = {
          items: {
            strong: {},
          } as unknown as SanitizerRule,
        };

        const result = sanitizeBlocks(blocksData, sanitizeConfig, {});

        const data = result[0].data;
        const items = data.items as string[];

        expect(items[0]).toContain('<strong>');
        expect(items[1]).not.toContain('<span>');
        expect(items[2]).not.toContain('<i>');
      });

      it('should handle non-string primitives unchanged', () => {
        const expectedCount = 42;
        const blocksData: Array<Pick<SavedData, 'data' | 'tool'>> = [
          {
            tool: 'custom',
            data: {
              count: expectedCount,
              active: true,
              text: '<strong>Text</strong>',
            },
          },
        ];

        const sanitizeConfig: SanitizerConfig = {
          text: {
            strong: {},
          } as unknown as SanitizerRule,
        };

        const result = sanitizeBlocks(blocksData, sanitizeConfig, {});

        const data = result[0].data;

        expect(data.count).toBe(expectedCount);
        expect(data.active).toBe(true);
        expect(data.text).toContain('<strong>');
      });
    });
  });

  describe('clean', () => {
    it('should clean HTML with custom config', () => {
      const taintString = '<strong>Bold</strong> <span>Span</span> <script>alert("XSS")</script>';
      const customConfig: SanitizerConfig = {
        strong: {},
      };

      const result = clean(taintString, customConfig);

      expect(result).toContain('<strong>');
      expect(result).not.toContain('<span>');
      expect(result).not.toContain('<script>');
    });

    it('should handle empty config', () => {
      const taintString = '<strong>Bold</strong>';
      const result = clean(taintString, {});

      // With empty config, HTMLJanitor should remove all tags
      expect(result).not.toContain('<strong>');
    });

    it('should handle empty string', () => {
      const result = clean('', {});

      expect(result).toBe('');
    });

    it('should handle non-HTML string', () => {
      const result = clean('Plain text without HTML', {});

      expect(result).toBe('Plain text without HTML');
    });
  });

  describe('composeSanitizerConfig', () => {
    it('should merge multiple configs', () => {
      const globalConfig: SanitizerConfig = {
        strong: {
          class: true,
        },
        span: {} as unknown as SanitizerRule,
      };

      const config1: SanitizerConfig = {
        strong: {
          id: true,
        },
      };

      const config2: SanitizerConfig = {
        span: {
          class: true,
        },
      };

      const result = composeSanitizerConfig(globalConfig, config1, config2);

      expect(result.strong).toEqual({
        class: true,
        id: true,
      });
      expect(result.span).toEqual({
        class: true,
      });
    });

    it('should handle empty globalConfig', () => {
      const config1: SanitizerConfig = {
        strong: {},
      };

      const config2: SanitizerConfig = {
        span: {},
      };

      const result = composeSanitizerConfig({} as SanitizerConfig, config1, config2);

      expect(result.strong).toBeDefined();
      expect(result.span).toBeDefined();
    });

    it('should skip tags not in base config', () => {
      const globalConfig: SanitizerConfig = {
        strong: {},
      };

      const config: SanitizerConfig = {
        strong: {
          class: true,
        },
        span: {}, // Not in globalConfig, should be skipped
      };

      const result = composeSanitizerConfig(globalConfig, config);

      expect(result.strong).toEqual({
        class: true,
      });
      expect(result.span).toBeUndefined();
    });

    it('should handle function values', () => {
      const globalConfig: SanitizerConfig = {
        a: {
          href: true,
        },
      };

      const config: SanitizerConfig = {
        a: (el: Element): { [attr: string]: boolean | string } => {
          const href = el.getAttribute('href');

          return href?.startsWith('http') ? { href: true,
            target: '_blank' } : { href: true };
        },
      };

      const result = composeSanitizerConfig(globalConfig, config);

      expect(typeof result.a).toBe('function');
    });

    it('should handle null/undefined configs', () => {
      const globalConfig: SanitizerConfig = {
        strong: {},
      };

      const result = composeSanitizerConfig(globalConfig, null as unknown as SanitizerConfig, undefined as unknown as SanitizerConfig);

      expect(result.strong).toBeDefined();
    });

    it('should handle boolean values', () => {
      const globalConfig: SanitizerConfig = {
        strong: {},
        span: true,
      };

      const config: SanitizerConfig = {
        strong: true,
        span: false,
      };

      const result = composeSanitizerConfig(globalConfig, config);

      expect(result.strong).toEqual({});
      expect(result.span).toBe(false);
    });

    it('should handle string values', () => {
      const globalConfig: SanitizerConfig = {
        a: {
          href: true,
        },
      };

      const config: SanitizerConfig = {
        a: 'custom-rule' as unknown as SanitizerRule,
      };

      const result = composeSanitizerConfig(globalConfig, config);

      expect(result.a).toBe('custom-rule');
    });
  });

  describe('getEffectiveRuleForString edge cases', () => {
    it('should handle rule === false', () => {
      const blocksData: Array<Pick<SavedData, 'data' | 'tool'>> = [
        {
          tool: 'paragraph',
          data: {
            text: '<strong>Bold</strong>',
          },
        },
      ];

      const sanitizeConfig: SanitizerConfig = {
        text: false,
      };

      const result = sanitizeBlocks(blocksData, sanitizeConfig, {});

      // When rule is false, should return empty config (no tags allowed)
      expect(result[0].data.text).not.toContain('<strong>');
    });

    it('should handle rule === true', () => {
      const blocksData: Array<Pick<SavedData, 'data' | 'tool'>> = [
        {
          tool: 'paragraph',
          data: {
            text: '<strong>Bold</strong> <span>bad</span>',
          },
        },
      ];

      const sanitizeConfig: SanitizerConfig = {
        text: true,
      };

      const globalSanitizer: SanitizerConfig = {
        strong: {},
      };

      const result = sanitizeBlocks(blocksData, sanitizeConfig, globalSanitizer);

      // When rule is true, should use global rules
      expect(result[0].data.text).toContain('<strong>');
      expect(result[0].data.text).not.toContain('<span>');
    });

    it('should handle rule === true with empty globalSanitizer', () => {
      const blocksData: Array<Pick<SavedData, 'data' | 'tool'>> = [
        {
          tool: 'paragraph',
          data: {
            text: '<strong>Bold</strong>',
          },
        },
      ];

      const sanitizeConfig: SanitizerConfig = {
        text: true,
      };

      const result = sanitizeBlocks(blocksData, sanitizeConfig, {});

      // When rule is true but globalSanitizer is empty, should strip unsafe URLs only
      expect(result[0].data.text).toBe('<strong>Bold</strong>');
    });
  });

  describe('mergeTagRules edge cases', () => {
    it('should prioritize field function over global function', () => {
      const blocksData: Array<Pick<SavedData, 'data' | 'tool'>> = [
        {
          tool: 'paragraph',
          data: {
            text: '<a href="https://example.com">Link</a>',
          },
        },
      ];

      const globalSanitizer: SanitizerConfig = {
        a: (_el: Element) => {
          return { href: true };
        },
      };

      const sanitizeConfig: SanitizerConfig = {
        text: {
          a: (el: Element): { [attr: string]: boolean | string } => {
            const href = el.getAttribute('href');

            return href?.startsWith('http') ? { href: true,
              target: '_blank' } : { href: true };
          },
        } as unknown as SanitizerRule,
      };

      const result = sanitizeBlocks(blocksData, sanitizeConfig, globalSanitizer);

      // Field function should be used
      expect(result[0].data.text).toContain('target="_blank"');
    });

    it('should handle fieldValue === false', () => {
      const blocksData: Array<Pick<SavedData, 'data' | 'tool'>> = [
        {
          tool: 'paragraph',
          data: {
            text: '<strong>Bold</strong> <span>Span</span>',
          },
        },
      ];

      const globalSanitizer: SanitizerConfig = {
        strong: {},
        span: {},
      };

      const sanitizeConfig: SanitizerConfig = {
        text: {
          span: false,
        },
      };

      const result = sanitizeBlocks(blocksData, sanitizeConfig, globalSanitizer);

      expect(result[0].data.text).toContain('<strong>');
      expect(result[0].data.text).not.toContain('<span>');
    });

    it('should handle fieldValue === true', () => {
      const blocksData: Array<Pick<SavedData, 'data' | 'tool'>> = [
        {
          tool: 'paragraph',
          data: {
            text: '<strong>Bold</strong>',
          },
        },
      ];

      const globalSanitizer: SanitizerConfig = {
        strong: {
          class: true,
        },
      };

      const sanitizeConfig: SanitizerConfig = {
        text: {
          strong: true,
        },
      };

      const result = sanitizeBlocks(blocksData, sanitizeConfig, globalSanitizer);

      // When fieldValue is true, should use empty config (all attributes allowed)
      expect(result[0].data.text).toContain('<strong>');
    });

    it('should merge object values', () => {
      const blocksData: Array<Pick<SavedData, 'data' | 'tool'>> = [
        {
          tool: 'paragraph',
          data: {
            text: '<a href="https://example.com" class="link">Link</a>',
          },
        },
      ];

      const globalSanitizer: SanitizerConfig = {
        a: {
          href: true,
        },
      };

      const sanitizeConfig: SanitizerConfig = {
        text: {
          a: {
            class: true,
          },
        } as unknown as SanitizerRule,
      };

      const result = sanitizeBlocks(blocksData, sanitizeConfig, globalSanitizer);

      expect(result[0].data.text).toContain('href="https://example.com"');
      expect(result[0].data.text).toContain('class="link"');
    });
  });

  describe('img tag preservation in paragraph sanitize config', () => {
    it('should preserve img tags with src when paragraph config includes img', () => {
      const blocksData: Array<Pick<SavedData, 'data' | 'tool'>> = [
        {
          tool: 'paragraph',
          data: {
            text: '<img src="https://media.dodostatic.net/image/photo.jpg" style="width: 100%;"><br>',
          },
        },
      ];

      /**
       * Simulates the effective paragraph sanitize config after BlockToolAdapter merges
       * the paragraph's own rules with inline tool rules.
       * The paragraph tool must include img in its sanitize config for this to work.
       */
      const paragraphSanitizeConfig: SanitizerConfig = {
        text: {
          br: true,
          img: {
            src: true,
            style: true,
          },
        } as unknown as SanitizerRule,
      };

      const result = sanitizeBlocks(blocksData, paragraphSanitizeConfig, {});

      expect(result[0].data.text).toContain('<img');
      expect(result[0].data.text).toContain('src="https://media.dodostatic.net/image/photo.jpg"');
    });

    it('should strip img tags when paragraph config does NOT include img', () => {
      const blocksData: Array<Pick<SavedData, 'data' | 'tool'>> = [
        {
          tool: 'paragraph',
          data: {
            text: '<img src="https://example.com/photo.jpg"><br>',
          },
        },
      ];

      const paragraphSanitizeConfigWithoutImg: SanitizerConfig = {
        text: {
          br: true,
        } as unknown as SanitizerRule,
      };

      const result = sanitizeBlocks(blocksData, paragraphSanitizeConfigWithoutImg, {});

      expect(result[0].data.text).not.toContain('<img');
      expect(result[0].data.text).toContain('<br>');
    });

    it('should preserve block-level HTML tags (p, ul, li, span) when paragraph config includes them', () => {
      const blocksData: Array<Pick<SavedData, 'data' | 'tool'>> = [
        {
          tool: 'paragraph',
          data: {
            text: '<p>Utiliza:</p><ul><li>separadores <span style="font-size: 1rem;">gastronorm,</span></li><li>recipientes gastronorm</li></ul><p>Los ingredientes deben estar cubiertos.</p>',
          },
        },
      ];

      const paragraphSanitizeConfig: SanitizerConfig = {
        text: {
          br: true,
          img: {
            src: true,
            style: true,
          },
          p: true,
          ul: true,
          li: true,
          span: {
            style: true,
          },
        } as unknown as SanitizerRule,
      };

      const result = sanitizeBlocks(blocksData, paragraphSanitizeConfig, {});

      expect(result[0].data.text).toContain('<p>');
      expect(result[0].data.text).toContain('<ul>');
      expect(result[0].data.text).toContain('<li>');
      expect(result[0].data.text).toContain('<span');
      expect(result[0].data.text).toContain('style="font-size: 1rem;"');
    });
  });

  describe('stripUnsafeUrls edge cases', () => {
    it('should strip javascript: URLs with single quotes', () => {
      const blocksData: Array<Pick<SavedData, 'data' | 'tool'>> = [
        {
          tool: 'paragraph',
          data: {
            text: '<a href=\'javascript:alert(1)\'>Link</a>',
          },
        },
      ];

      const sanitizeConfig: SanitizerConfig = {
        text: {
          a: {
            href: true,
          },
        } as unknown as SanitizerRule,
      };

      const result = sanitizeBlocks(blocksData, sanitizeConfig, {});

      expect(result[0].data.text).not.toContain('javascript:');
    });

    it('should strip javascript: URLs with double quotes', () => {
      const blocksData: Array<Pick<SavedData, 'data' | 'tool'>> = [
        {
          tool: 'paragraph',
          data: {
            text: '<a href="javascript:alert(1)">Link</a>',
          },
        },
      ];

      const sanitizeConfig: SanitizerConfig = {
        text: {
          a: {
            href: true,
          },
        } as unknown as SanitizerRule,
      };

      const result = sanitizeBlocks(blocksData, sanitizeConfig, {});

      expect(result[0].data.text).not.toContain('javascript:');
    });

    it('should strip javascript: URLs without quotes', () => {
      const blocksData: Array<Pick<SavedData, 'data' | 'tool'>> = [
        {
          tool: 'paragraph',
          data: {
            text: '<a href=javascript:alert(1)>Link</a>',
          },
        },
      ];

      const sanitizeConfig: SanitizerConfig = {
        text: {
          a: {
            href: true,
          },
        } as unknown as SanitizerRule,
      };

      const result = sanitizeBlocks(blocksData, sanitizeConfig, {});

      expect(result[0].data.text).not.toContain('javascript:');
    });

    it('should strip data:text/html URLs', () => {
      const blocksData: Array<Pick<SavedData, 'data' | 'tool'>> = [
        {
          tool: 'paragraph',
          data: {
            text: '<img src="data:text/html,<script>alert(1)</script>">',
          },
        },
      ];

      const sanitizeConfig: SanitizerConfig = {
        text: {
          img: {
            src: true,
          },
        } as unknown as SanitizerRule,
      };

      const result = sanitizeBlocks(blocksData, sanitizeConfig, {});

      expect(result[0].data.text).not.toContain('data:text/html');
    });

    it('should handle URLs with spaces', () => {
      const blocksData: Array<Pick<SavedData, 'data' | 'tool'>> = [
        {
          tool: 'paragraph',
          data: {
            text: '<a href="javascript: alert(1)">Link</a>',
          },
        },
      ];

      const sanitizeConfig: SanitizerConfig = {
        text: {
          a: {
            href: true,
          },
        } as unknown as SanitizerRule,
      };

      const result = sanitizeBlocks(blocksData, sanitizeConfig, {});

      expect(result[0].data.text).not.toContain('javascript:');
    });
  });

  describe('applyAttributeOverrides edge cases', () => {
    it('should remove attribute when function returns false', () => {
      const blocksData: Array<Pick<SavedData, 'data' | 'tool'>> = [
        {
          tool: 'paragraph',
          data: {
            text: '<a href="https://example.com" class="link">Link</a>',
          },
        },
      ];

      const sanitizeConfig: SanitizerConfig = {
        text: {
          a: (_el: Element) => {
            return {
              href: true,
              class: false, // Should remove class attribute
            };
          },
        } as unknown as SanitizerRule,
      };

      const result = sanitizeBlocks(blocksData, sanitizeConfig, {});

      expect(result[0].data.text).toContain('href="https://example.com"');
      expect(result[0].data.text).not.toContain('class="link"');
    });

    it('should keep attribute when function returns true', () => {
      const blocksData: Array<Pick<SavedData, 'data' | 'tool'>> = [
        {
          tool: 'paragraph',
          data: {
            text: '<a href="https://example.com" class="link">Link</a>',
          },
        },
      ];

      const sanitizeConfig: SanitizerConfig = {
        text: {
          a: (_el: Element) => {
            return {
              href: true,
              class: true, // Should keep class attribute
            };
          },
        } as unknown as SanitizerRule,
      };

      const result = sanitizeBlocks(blocksData, sanitizeConfig, {});

      expect(result[0].data.text).toContain('href="https://example.com"');
      expect(result[0].data.text).toContain('class="link"');
    });

    it('should set attribute value when function returns string', () => {
      const blocksData: Array<Pick<SavedData, 'data' | 'tool'>> = [
        {
          tool: 'paragraph',
          data: {
            text: '<a href="https://example.com">Link</a>',
          },
        },
      ];

      const sanitizeConfig: SanitizerConfig = {
        text: {
          a: (el: Element): { [attr: string]: boolean | string } => {
            const href = el.getAttribute('href');

            return {
              href: true,
              ...(href?.startsWith('http') && { target: '_blank' }),
            };
          },
        } as unknown as SanitizerRule,
      };

      const result = sanitizeBlocks(blocksData, sanitizeConfig, {});

      expect(result[0].data.text).toContain('href="https://example.com"');
      expect(result[0].data.text).toContain('target="_blank"');
    });

    it('should handle function returning null', () => {
      const blocksData: Array<Pick<SavedData, 'data' | 'tool'>> = [
        {
          tool: 'paragraph',
          data: {
            text: '<a href="https://example.com">Link</a>',
          },
        },
      ];

      const sanitizeConfig: SanitizerConfig = {
        text: {
          a: () => null as unknown as SanitizerRule,
        } as unknown as SanitizerRule,
      };

      const result = sanitizeBlocks(blocksData, sanitizeConfig, {});

      // Should not crash and should still sanitize
      expect(result[0].data.text).toBeDefined();
    });

    it('should handle function returning boolean directly', () => {
      const blocksData: Array<Pick<SavedData, 'data' | 'tool'>> = [
        {
          tool: 'paragraph',
          data: {
            text: '<a href="https://example.com">Link</a>',
          },
        },
      ];

      const sanitizeConfig: SanitizerConfig = {
        text: {
          a: () => false as unknown as SanitizerRule,
        } as unknown as SanitizerRule,
      };

      const result = sanitizeBlocks(blocksData, sanitizeConfig, {});

      // Should not crash
      expect(result[0].data.text).toBeDefined();
    });

    it('should handle multiple elements with function rules', () => {
      const blocksData: Array<Pick<SavedData, 'data' | 'tool'>> = [
        {
          tool: 'paragraph',
          data: {
            text: '<a href="https://example.com">Link 1</a> <a href="https://test.com">Link 2</a>',
          },
        },
      ];

      const sanitizeConfig: SanitizerConfig = {
        text: {
          a: (el: Element): { [attr: string]: boolean | string } => {
            const href = el.getAttribute('href');

            return {
              href: true,
              ...(href?.startsWith('http') && { target: '_blank' }),
            };
          },
        } as unknown as SanitizerRule,
      };

      const result = sanitizeBlocks(blocksData, sanitizeConfig, {});

      const text = result[0].data.text as string;

      expect(text).toContain('target="_blank"');
      // Both links should have target="_blank"
      const matches = text.match(/target="_blank"/g);

      expect(matches).toHaveLength(2);
    });
  });

  describe('cleanObject edge cases', () => {
    it('should handle rules === true at object level', () => {
      const blocksData: Array<Pick<SavedData, 'data' | 'tool'>> = [
        {
          tool: 'paragraph',
          data: {
            text: '<strong>Bold</strong> <span>bad</span>',
          },
        },
      ];

      const globalSanitizer: SanitizerConfig = {
        strong: {},
      };

      const sanitizeConfig: SanitizerConfig = {
        text: true,
      };

      const result = sanitizeBlocks(blocksData, sanitizeConfig, globalSanitizer);

      expect(result[0].data.text).toContain('<strong>');
      expect(result[0].data.text).not.toContain('<span>');
    });

    it('should handle rules === false at object level', () => {
      const blocksData: Array<Pick<SavedData, 'data' | 'tool'>> = [
        {
          tool: 'paragraph',
          data: {
            text: '<strong>Bold</strong>',
          },
        },
      ];

      const sanitizeConfig: SanitizerConfig = {
        text: false,
      };

      const result = sanitizeBlocks(blocksData, sanitizeConfig, {});

      expect(result[0].data.text).not.toContain('<strong>');
    });

    it('should use field-specific rule when available', () => {
      const blocksData: Array<Pick<SavedData, 'data' | 'tool'>> = [
        {
          tool: 'paragraph',
          data: {
            title: '<strong>Title</strong> <span>bad</span>',
            content: '<strong>Content</strong> <span>bad</span>',
          },
        },
      ];

      const sanitizeConfig: SanitizerConfig = {
        title: {
          strong: {},
        } as unknown as SanitizerRule,
        content: {
          span: {},
        } as unknown as SanitizerRule,
      };

      const result = sanitizeBlocks(blocksData, sanitizeConfig, {});

      const data = result[0].data;

      expect(data.title).toContain('<strong>');
      expect(data.title).not.toContain('<span>');
      expect(data.content).not.toContain('<strong>');
      expect(data.content).toContain('<span>');
    });
  });

  describe('cloneTagConfig edge cases', () => {
    it('should handle string rule type', () => {
      const config: SanitizerConfig = {
        a: 'custom-string' as unknown as SanitizerRule,
      };

      const result = composeSanitizerConfig({} as SanitizerConfig, config);

      expect(result.a).toBe('custom-string');
    });

    it('should handle function rule type', () => {
      const fn = (_el: Element): { [attr: string]: boolean | string } => ({ href: true });

      const config: SanitizerConfig = {
        a: fn,
      };

      const result = composeSanitizerConfig({} as SanitizerConfig, config);

      expect(result.a).toBe(fn);
    });
  });
});

