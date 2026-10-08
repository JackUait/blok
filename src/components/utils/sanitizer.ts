
/**
 * Blok Sanitizer
 *
 * Clears HTML from taint tags
 * @version 2.0.0
 * @example
 *
 * clean(yourTaintString, yourConfig);
 *
 * {@link SanitizerConfig}
 */


/**
 * @typedef {object} SanitizerConfig
 * @property {object} tags - define tags restrictions
 * @example
 *
 * tags : {
 *     p: true,
 *     a: {
 *       href: true,
 *       rel: "nofollow",
 *       target: "_blank"
 *     }
 * }
 */

import HTMLJanitor from 'html-janitor';

import type { BlockToolData, SanitizerConfig, SanitizerRule } from '../../../types';
import type { TagConfig, ToolSanitizerConfig } from '../../../types/configs/sanitizer-config';
import type { SavedData } from '../../../types/data-formats';
import { protectPageReferenceAnchor } from '../../shared/page-reference';
import { isSafeAttribute, PLAINTEXT } from '../../shared/sanitize-rules';
import {
  cloneSanitizerConfig,
  cloneTagConfig,
  getEffectiveRuleForString,
  isPlaintextRule,
  isRule,
  MAX_SANITIZE_DEPTH,
  walkSanitize,
  type DeepData,
  type DeepSanitizerRule,
} from '../../shared/sanitize-walk';
import { hasUnsafeUrlProtocol } from '../../shared/url-policy';
import { deepMerge, isBoolean, isEmpty, isFunction, isObject, isString } from '../utils';
import { normalizeInlineMarkupHtml, renameLegacyBoldHtml } from './inline-normalization';

/**
 * Re-exported from the pure shared module so existing imports keep working;
 * see {@link module:src/shared/sanitize-rules} for the definitions.
 */
export { isSafeAttribute, PLAINTEXT };

/**
 * Fallback (no-DOM) matcher for href/src attributes: captures the attribute
 * name and its value so the value can be normalized before the scheme check.
 */
const URL_ATTR_FALLBACK_PATTERN = /\s*(href|src)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]*))/gi;

/**
 * Sanitize Blocks
 *
 * Enumerate blocks and clean data
 * @param blocksData - blocks' data to sanitize
 * @param sanitizeConfig — sanitize config to use or function to get config for Tool
 * @param globalSanitizer — global sanitizer config defined on blok level
 */
export const sanitizeBlocks = (
  blocksData: Array<Pick<SavedData, 'data' | 'tool'>>,
  sanitizeConfig: SanitizerConfig | ToolSanitizerConfig | ((toolName: string) => SanitizerConfig | ToolSanitizerConfig | undefined),
  globalSanitizer: SanitizerConfig = {}
): Array<Pick<SavedData, 'data' | 'tool'>> => {
  return blocksData.map((block) => {
    const toolConfig = isFunction(sanitizeConfig) ? sanitizeConfig(block.tool) : sanitizeConfig;
    const rules: DeepSanitizerRule = (toolConfig ?? {}) as SanitizerConfig;

    if (isObject(rules) && isEmpty(rules) && isEmpty(globalSanitizer)) {
      /**
       * Tag allowlisting is opt-in per tool, but URL hardening is not: this
       * path carries forged `application/x-blok` clipboard JSON, and a tool
       * that declares no sanitize config still renders `data.text`.
       * Never hands the caller's object back by reference either.
       */
      return { ...block,
        data: stripUnsafeUrlsDeep(block.data) };
    }

    return {
      ...block,
      data: walkSanitize(block.data, rules, globalSanitizer, cleanOneItem) as BlockToolData,
    };
  });
};
/**
 * Cleans string from unwanted tags
 * Method allows to use default config
 * @param {string} taintString - taint string
 * @param {SanitizerConfig} customConfig - allowed tags
 * @returns {string} clean HTML
 */
export const clean = (taintString: string, customConfig: SanitizerConfig = {}): string => {
  /**
   * PLAINTEXT is a field-level directive, not a tag rule — html-janitor has no
   * meaning for it. Drop such entries at the boundary so a config carrying one
   * can never be handed to the parser.
   */
  const tags = Object.fromEntries(
    Object.entries(customConfig).filter(([, rule]) => !isPlaintextRule(rule))
  ) as Record<string, TagConfig | ((el: Element) => TagConfig)>;
  const anchorRule = tags.a;

  if (anchorRule !== undefined && anchorRule !== false) {
    tags.a = protectPageReferenceAnchor(anchorRule);
  }

  const sanitizerConfig = {
    tags,
  };

  /**
   * API client can use custom config to manage sanitize process
   */
  const sanitizerInstance = new HTMLJanitor(sanitizerConfig);

  /**
   * html-janitor allowlists the `href`/`src` ATTRIBUTE and never looks at its
   * value, so an allowlisted anchor keeps whatever scheme it carried. The
   * scheme pass belongs here rather than at each call site: `clean()` is the
   * public sanitizer (`api.sanitizer.clean`) and every caller that forgot it
   * shipped a live `javascript:` link.
   */
  return stripUnsafeUrls(sanitizerInstance.clean(taintString));
};

/**
 * Whether a tag config keeps the tag at all.
 * @param config - tag allowlist
 */
const allowsTag = (config: SanitizerConfig) => (tag: string): boolean => config[tag] !== undefined && config[tag] !== false;

/**
 * Clean primitive value
 * @param {string} taintString - string to clean
 * @param {SanitizerConfig|boolean} rule - sanitizer rule
 * @param {SanitizerConfig} globalRules - global sanitizer config
 * @returns {string}
 */
const cleanOneItem = (
  taintString: string,
  rule: DeepSanitizerRule,
  globalRules: SanitizerConfig
): string => {
  /**
   * Plaintext fields are not markup — parsing them is what corrupts them.
   * Bypasses the global sanitizer too: a host-level config must not be able
   * to mangle a field the tool declared as literal text.
   */
  if (isPlaintextRule(rule)) {
    return taintString;
  }

  const effectiveRule = getEffectiveRuleForString(rule, globalRules);

  if (effectiveRule) {
    const cleaned = clean(renameLegacyBoldHtml(taintString, allowsTag(effectiveRule)), effectiveRule);

    return normalizeInlineMarkupHtml(applyAttributeOverrides(cleaned, effectiveRule));
  }

  if (!isEmpty(globalRules)) {
    const cleaned = clean(renameLegacyBoldHtml(taintString, allowsTag(globalRules)), globalRules);

    return normalizeInlineMarkupHtml(applyAttributeOverrides(cleaned, globalRules));
  }

  return normalizeInlineMarkupHtml(stripUnsafeUrls(taintString));
};

/**
 * Remove `href`/`src` values whose scheme can execute (`javascript:`, `data:`).
 *
 * `clean()` already applies this. Exported for the paths that harden URLs
 * WITHOUT tag allowlisting — stored block data whose tool declares no sanitize
 * config (see {@link stripUnsafeUrlsDeep}).
 * @param value - HTML to harden
 * @returns the HTML with executable-scheme URL attributes removed
 */
export const stripUnsafeUrls = (value: string): string => {
  if (!value || value.indexOf('<') === -1) {
    return value;
  }

  if (typeof document !== 'undefined') {
    const template = document.createElement('template');

    template.innerHTML = value;

    const unsafe = Array.from(template.content.querySelectorAll('[href],[src]'))
      .flatMap((element) => ['href', 'src']
        .filter((attribute) => hasUnsafeUrlProtocol(element.getAttribute(attribute), attribute))
        .map((attribute) => ({ element,
          attribute })));

    /**
     * The innerHTML round-trip is a parser, not a transform: it entity-encodes
     * bare `<`/`&` and silently deletes text that looks like a stray end tag.
     * That destroys plaintext fields (code, captions) which legitimately carry
     * those characters. Only pay the round-trip when an attribute actually
     * needs stripping — otherwise the input is returned byte-identical.
     */
    if (unsafe.length === 0) {
      return value;
    }

    unsafe.forEach(({ element, attribute }) => element.removeAttribute(attribute));

    return template.innerHTML;
  }

  return value.replace(
    URL_ATTR_FALLBACK_PATTERN,
    (match, attribute: string, doubleQuoted?: string, singleQuoted?: string, unquoted?: string) => {
      const url = doubleQuoted ?? singleQuoted ?? unquoted ?? '';

      return hasUnsafeUrlProtocol(url, attribute.toLowerCase()) ? '' : match;
    }
  );
};

/**
 * Applies the URL-scheme safety pass to every string in block data, rebuilding
 * containers along the way. Used by the render path so scheme hardening never
 * depends on the tool declaring a sanitize config (tag allowlisting stays
 * opt-in per tool), and so caller-owned data is never retained by reference.
 * @param data - stored block data
 */
export const stripUnsafeUrlsDeep = (
  data: BlockToolData,
  rules?: SanitizerConfig | ToolSanitizerConfig
): BlockToolData => {
  return stripUnsafeUrlsDeepValue(data, rules as DeepSanitizerRule) as BlockToolData;
};

const stripUnsafeUrlsDeepValue = (value: DeepData, rules?: DeepSanitizerRule, depth = 0): DeepData => {
  if (depth > MAX_SANITIZE_DEPTH) {
    return null;
  }

  if (Array.isArray(value)) {
    return value.map((item) => stripUnsafeUrlsDeepValue(item, rules, depth + 1));
  }

  if (isObject(value)) {
    const result: Record<string, unknown> = {};
    const rulesRecord = isObject(rules) ? (rules as Record<string, DeepSanitizerRule>) : undefined;

    Object.entries(value).forEach(([key, item]) => {
      const ruleCandidate = rulesRecord?.[key];
      const ruleForItem = ruleCandidate !== undefined && isRule(ruleCandidate) ? ruleCandidate : rules;

      result[key] = stripUnsafeUrlsDeepValue(item as DeepData, ruleForItem, depth + 1);
    });

    return result;
  }

  if (isString(value)) {
    /**
     * A PLAINTEXT field carries no URLs to harden — it carries source text
     * that may merely look like markup. Running the pass would re-introduce
     * the corruption this sentinel exists to prevent.
     */
    return isPlaintextRule(rules as DeepSanitizerRule) ? value : stripUnsafeUrls(value);
  }

  return value;
};

/**
 *
 * @param {SanitizerConfig} globalConfig - base global sanitizer config
 * @param {...SanitizerConfig[]} configs - additional sanitizer configs to compose
 */
export const composeSanitizerConfig = (
  globalConfig: SanitizerConfig,
  ...configs: SanitizerConfig[]
): SanitizerConfig => {
  if (isEmpty(globalConfig)) {
    return Object.assign({}, ...configs) as SanitizerConfig;
  }

  const base = cloneSanitizerConfig(globalConfig);

  configs.forEach((config) => {
    if (!config) {
      return;
    }

    for (const tag in config) {
      if (!Object.prototype.hasOwnProperty.call(config, tag)) {
        continue;
      }

      const sourceValue = config[tag];

      /**
       * If the tag doesn't exist in base, skip it to respect the base config
       */
      if (!Object.prototype.hasOwnProperty.call(base, tag)) {
        continue;
      }

      const targetValue = base[tag];

      if (isFunction(sourceValue)) {
        base[tag] = sourceValue;

        continue;
      }

      if (sourceValue === true && isFunction(targetValue)) {
        continue;
      }

      if (sourceValue === true) {
        const targetIsPlainObject = isObject(targetValue) && !isFunction(targetValue);

        base[tag] = targetIsPlainObject
          ? deepMerge({}, targetValue as SanitizerConfig)
          : cloneTagConfig(sourceValue);

        continue;
      }

      if (isObject(sourceValue) && isObject(targetValue)) {
        base[tag] = deepMerge({}, targetValue as SanitizerConfig, sourceValue as SanitizerConfig);

        continue;
      }

      base[tag] = cloneTagConfig(sourceValue);
    }
  });

  return base;
};

const applyAttributeOverrides = (html: string, rules: SanitizerConfig): string => {
  if (typeof document === 'undefined' || !html || html.indexOf('<') === -1) {
    return html;
  }

  const entries = Object.entries(rules).filter(([, value]) => isFunction(value));

  if (entries.length === 0) {
    return html;
  }

  const template = document.createElement('template');

  template.innerHTML = html;

  entries.forEach(([tag, rule]) => {
    const elements = template.content.querySelectorAll(tag);

    elements.forEach((element) => {
      const ruleResult = (rule as (el: Element) => SanitizerRule)(element);

      if (isBoolean(ruleResult) || isFunction(ruleResult) || ruleResult == null) {
        return;
      }

      for (const [attr, attrRule] of Object.entries(ruleResult)) {
        if (attrRule === false) {
          element.removeAttribute(attr);

          continue;
        }

        if (attrRule === true) {
          continue;
        }

        if (isString(attrRule)) {
          element.setAttribute(attr, attrRule);
        }
      }
    });
  });

  return template.innerHTML;
};
