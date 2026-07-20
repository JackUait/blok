
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
import { deepMerge, isBoolean, isEmpty, isFunction, isObject, isString } from '../utils';
import { isSafeRasterImageDataUrl, stripIgnoredUrlChars } from './sanitize-url';

type DeepSanitizerRule = SanitizerConfig | SanitizerRule;

/**
 * Sentinel marking a block-data field as plaintext rather than HTML.
 *
 * Sanitization is an HTML parse: it entity-encodes bare `<`/`&` and deletes
 * text that looks like a stray end tag. That is correct for rich-text fields
 * and destructive for fields storing literal source text (a code block's
 * `code`). Declaring the field PLAINTEXT skips both janitor and the URL-scheme
 * pass, so the value round-trips byte-identical.
 *
 * A plain string (not a Symbol) so it survives JSON and structuredClone —
 * tool sanitize configs are a public surface hosts may serialize.
 */
export const PLAINTEXT = 'plaintext';

/**
 * Whether a resolved rule declares its field as plaintext.
 * @param rule - sanitizer rule to test
 */
const isPlaintextRule = (rule: DeepSanitizerRule): boolean => {
  return rule === PLAINTEXT;
};

/**
 * Recursive type for data that can contain nested arrays
 */
type DeepData = string | Record<string, unknown> | Array<DeepData>;

/**
 * Script-capable schemes hard-stripped from href/src regardless of tool
 * config. Deliberately NOT a full allowlist: unknown custom schemes
 * (slack://, ftp:) in existing documents must keep working.
 */
const SCRIPT_CAPABLE_SCHEME_PATTERN = /^(?:javascript|vbscript):/i;
const DATA_SCHEME_PATTERN = /^data:/i;
const BLOB_SCHEME_PATTERN = /^blob:/i;

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
  globalSanitizer: SanitizerConfig = {} as SanitizerConfig
): Array<Pick<SavedData, 'data' | 'tool'>> => {
  return blocksData.map((block) => {
    const toolConfig = isFunction(sanitizeConfig) ? sanitizeConfig(block.tool) : sanitizeConfig;
    const rules: DeepSanitizerRule = (toolConfig ?? {}) as SanitizerConfig;

    if (isObject(rules) && isEmpty(rules) && isEmpty(globalSanitizer)) {
      // No rules to apply, but never hand the caller's object back by
      // reference — downstream consumers must not retain caller-owned data.
      return { ...block };
    }

    return {
      ...block,
      data: deepSanitize(block.data, rules, globalSanitizer) as BlockToolData,
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
export const clean = (taintString: string, customConfig: SanitizerConfig = {} as SanitizerConfig): string => {
  /**
   * PLAINTEXT is a field-level directive, not a tag rule — html-janitor has no
   * meaning for it. Drop such entries at the boundary so a config carrying one
   * can never be handed to the parser.
   */
  const tags = Object.fromEntries(
    Object.entries(customConfig).filter(([, rule]) => !isPlaintextRule(rule))
  ) as Record<string, TagConfig | ((el: Element) => TagConfig)>;

  const sanitizerConfig = {
    tags,
  };

  /**
   * API client can use custom config to manage sanitize process
   */
  const sanitizerInstance = new HTMLJanitor(sanitizerConfig);

  return sanitizerInstance.clean(taintString);
};

/**
 * Method recursively reduces Block's data and cleans with passed rules
 * @param {BlockToolData|object|*} dataToSanitize - taint string or object/array that contains taint string
 * @param {SanitizerConfig} rules - object with sanitizer rules
 * @param {SanitizerConfig} globalRules - global sanitizer config
 */
const deepSanitize = (
  dataToSanitize: DeepData,
  rules: DeepSanitizerRule,
  globalRules: SanitizerConfig
): DeepData => {
  /**
   * BlockData It may contain 3 types:
   *  - Array
   *  - Object
   *  - Primitive
   */
  if (Array.isArray(dataToSanitize)) {
    /**
     * Array: call sanitize for each item
     */
    return cleanArray(dataToSanitize, rules, globalRules);
  }

  if (isObject(dataToSanitize)) {
    /**
     * Objects: just clean object deeper.
     */
    return cleanObject(dataToSanitize, rules, globalRules);
  }

  /**
   * Primitives (number|string|boolean): clean this item
   *
   * Clean only strings
   */
  if (isString(dataToSanitize)) {
    return cleanOneItem(dataToSanitize, rules, globalRules);
  }

  return dataToSanitize;
};

/**
 * Clean array
 * @param {Array} array - [1, 2, {}, []]
 * @param {SanitizerConfig} ruleForItem - sanitizer config for array
 * @param {SanitizerConfig} globalRules - global sanitizer config
 */
const cleanArray = (
  array: Array<DeepData>,
  ruleForItem: DeepSanitizerRule,
  globalRules: SanitizerConfig
): Array<DeepData> => {
  return array.map((arrayItem) => deepSanitize(arrayItem, ruleForItem, globalRules));
};

/**
 * Clean object
 * @param {object} object  - {level: 0, text: 'adada', items: [1,2,3]}}
 * @param {object} rules - { b: true } or true|false
 * @param {SanitizerConfig} globalRules - global sanitizer config
 * @returns {object}
 */
const cleanObject = (
  object: Record<string, unknown>,
  rules: DeepSanitizerRule | Record<string, DeepSanitizerRule>,
  globalRules: SanitizerConfig
): Record<string, unknown> => {
  const cleanData: Record<string, DeepData> = {};
  const objectRecord = object;

  for (const fieldName in object) {
    if (!Object.prototype.hasOwnProperty.call(object, fieldName)) {
      continue;
    }

    const currentIterationItem = objectRecord[fieldName];

    /**
     *  Get object from config by field name
     *   - if it is a HTML Janitor rule, call with this rule
     *   - otherwise, call with parent's config
     */
    const rulesRecord = isObject(rules) ? (rules as Record<string, DeepSanitizerRule>) : undefined;
    const ruleCandidate = rulesRecord?.[fieldName];
    const ruleForItem = ruleCandidate !== undefined && isRule(ruleCandidate)
      ? ruleCandidate
      : rules;

    cleanData[fieldName] = deepSanitize(currentIterationItem as DeepData, ruleForItem as DeepSanitizerRule, globalRules);
  }

  return cleanData as Record<string, unknown>;
};

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
    const cleaned = clean(taintString, effectiveRule);

    return stripUnsafeUrls(applyAttributeOverrides(cleaned, effectiveRule));
  }

  if (!isEmpty(globalRules)) {
    const cleaned = clean(taintString, globalRules);

    return stripUnsafeUrls(applyAttributeOverrides(cleaned, globalRules));
  }

  return stripUnsafeUrls(taintString);
};

/**
 * Check if passed item is a HTML Janitor rule:
 * { a : true }, {}, false, true, function(){} — correct rules
 * undefined, null, 0, 1, 2 — not a rules
 * @param {SanitizerConfig} config - config to check
 */
const isRule = (config: DeepSanitizerRule): boolean => {
  return isObject(config) || isBoolean(config) || isFunction(config) || isPlaintextRule(config);
};

/**
 * Check whether a URL resolves to a script-capable scheme once the characters
 * browsers ignore during scheme resolution are removed — closes the
 * whitespace-smuggling class ("java\nscript:", "v\tbscript:", …).
 * @param value - raw attribute value
 * @param attribute - attribute the value belongs to ('href' or 'src')
 */
const hasUnsafeUrlProtocol = (value: string | null, attribute: string): boolean => {
  if (!value) {
    return false;
  }

  const normalized = stripIgnoredUrlChars(value);

  if (SCRIPT_CAPABLE_SCHEME_PATTERN.test(normalized)) {
    return true;
  }

  if (DATA_SCHEME_PATTERN.test(normalized)) {
    // Raster image data: URLs cannot carry script and stay valid in src;
    // every other data: payload (text/html, svg+xml, …) can execute.
    return !(attribute === 'src' && isSafeRasterImageDataUrl(normalized));
  }

  return attribute === 'href' && BLOB_SCHEME_PATTERN.test(normalized);
};

const stripUnsafeUrls = (value: string): string => {
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
  return stripUnsafeUrlsDeepValue(data as DeepData, rules as DeepSanitizerRule) as BlockToolData;
};

const stripUnsafeUrlsDeepValue = (value: DeepData, rules?: DeepSanitizerRule): DeepData => {
  if (Array.isArray(value)) {
    return value.map((item) => stripUnsafeUrlsDeepValue(item, rules));
  }

  if (isObject(value)) {
    const result: Record<string, unknown> = {};
    const rulesRecord = isObject(rules) ? (rules as Record<string, DeepSanitizerRule>) : undefined;

    Object.entries(value).forEach(([key, item]) => {
      const ruleCandidate = rulesRecord?.[key];
      const ruleForItem = ruleCandidate !== undefined && isRule(ruleCandidate) ? ruleCandidate : rules;

      result[key] = stripUnsafeUrlsDeepValue(item as DeepData, ruleForItem);
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
 * @param {SanitizerConfig} config - sanitizer config to clone
 */
const cloneSanitizerConfig = (config: SanitizerConfig): SanitizerConfig => {
  if (isEmpty(config)) {
    return {} as SanitizerConfig;
  }

  const cloned: SanitizerConfig = {} as SanitizerConfig;

  for (const tag in config) {
    if (!Object.prototype.hasOwnProperty.call(config, tag)) {
      continue;
    }

    cloned[tag] = cloneTagConfig(config[tag]);
  }

  return cloned;
};

/**
 *
 * @param {SanitizerRule} rule - tag rule to clone
 */
type SanitizerFunctionRule = (el: Element) => TagConfig;

const wrapFunctionRule = (rule: SanitizerFunctionRule): SanitizerFunctionRule => {
  return function wrappedRule(this: unknown, element: Element): TagConfig {
    const result = rule.call(this, element);

    if (result == null) {
      return {};
    }

    return result;
  };
};

const SAFE_ATTRIBUTES = new Set(['class', 'id', 'title', 'role', 'dir', 'lang']);

const isSafeAttribute = (attribute: string): boolean => {
  const lowerName = attribute.toLowerCase();

  return lowerName.startsWith('data-') || lowerName.startsWith('aria-') || SAFE_ATTRIBUTES.has(lowerName);
};

const preserveExistingAttributesRule: SanitizerFunctionRule = (element) => {
  const preserved: TagConfig = {};

  Array.from(element.attributes).forEach((attribute) => {
    if (!isSafeAttribute(attribute.name)) {
      return;
    }

    preserved[attribute.name] = true;
  });

  return preserved;
};

const cloneTagConfig = (rule: SanitizerRule): SanitizerRule => {
  if (rule === true) {
    return wrapFunctionRule(preserveExistingAttributesRule);
  }

  if (rule === false) {
    return false;
  }

  if (isFunction(rule)) {
    return wrapFunctionRule(rule as SanitizerFunctionRule);
  }

  if (isString(rule)) {
    return rule;
  }

  if (isObject(rule)) {
    return deepMerge({}, rule as Record<string, unknown>) as SanitizerRule;
  }

  return rule;
};

/**
 *
 * @param {SanitizerConfig} globalRules - global sanitizer config
 * @param {SanitizerConfig} fieldRules - field-specific sanitizer config
 */
const mergeTagRules = (globalRules: SanitizerConfig, fieldRules: SanitizerConfig): SanitizerConfig => {
  if (isEmpty(globalRules)) {
    return cloneSanitizerConfig(fieldRules);
  }

  const merged: SanitizerConfig = {} as SanitizerConfig;

  for (const tag in globalRules) {
    if (!Object.prototype.hasOwnProperty.call(globalRules, tag)) {
      continue;
    }

    const globalValue = globalRules[tag];
    const fieldValue = fieldRules ? fieldRules[tag] : undefined;

    /**
     * A tool's field FUNCTION rule only beats the global rule when the global
     * rule is itself a function (the field rule is the more specific one). When
     * the user's global config provides an explicit non-function rule for the
     * tag (e.g. `span: true`), that deliberate override must win — otherwise a
     * tool's narrow function (e.g. equation-span) would silently strip what the
     * user allowed globally.
     */
    if (isFunction(fieldValue) && isFunction(globalValue)) {
      merged[tag] = cloneTagConfig(fieldValue as SanitizerRule);

      continue;
    }

    if (isFunction(globalValue)) {
      merged[tag] = cloneTagConfig(globalValue as SanitizerRule);

      continue;
    }

    if (isObject(globalValue) && isObject(fieldValue)) {
      merged[tag] = deepMerge({}, fieldValue as SanitizerConfig, globalValue as SanitizerConfig);

      continue;
    }

    if (fieldValue !== undefined && !isFunction(fieldValue)) {
      merged[tag] = cloneTagConfig(fieldValue);

      continue;
    }

    merged[tag] = cloneTagConfig(globalValue);
  }

  /**
   * Include tags from field rules that are not present in global rules.
   * Tool-specific sanitize configs should be able to allow tags
   * beyond what the global config defines.
   */
  if (!fieldRules) {
    return merged;
  }

  for (const tag in fieldRules) {
    if (!Object.prototype.hasOwnProperty.call(fieldRules, tag)) {
      continue;
    }

    if (Object.prototype.hasOwnProperty.call(merged, tag)) {
      continue;
    }

    merged[tag] = cloneTagConfig(fieldRules[tag]);
  }

  return merged;
};

/**
 *
 * @param {DeepSanitizerRule} rule - sanitizer rule to evaluate
 * @param {SanitizerConfig} globalRules - global sanitizer config
 */
const getEffectiveRuleForString = (
  rule: DeepSanitizerRule,
  globalRules: SanitizerConfig
): SanitizerConfig | null => {
  if (isObject(rule) && !isFunction(rule)) {
    return mergeTagRules(globalRules, rule as SanitizerConfig);
  }

  if (rule === false) {
    return {} as SanitizerConfig;
  }

  if (isEmpty(globalRules)) {
    return null;
  }

  return cloneSanitizerConfig(globalRules);
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
          : cloneTagConfig(sourceValue as SanitizerRule);

        continue;
      }

      if (isObject(sourceValue) && isObject(targetValue)) {
        base[tag] = deepMerge({}, targetValue as SanitizerConfig, sourceValue as SanitizerConfig);

        continue;
      }

      base[tag] = cloneTagConfig(sourceValue as SanitizerRule);
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
