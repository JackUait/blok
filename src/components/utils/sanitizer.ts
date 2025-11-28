
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

import * as _ from '../utils';

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
import type { TagConfig } from '../../../types/configs/sanitizer-config';
import type { SavedData } from '../../../types/data-formats';

type DeepSanitizerRule = SanitizerConfig | SanitizerRule | boolean;

const UNSAFE_URL_PROTOCOL_PATTERN = /^\s*(?:javascript\s*:|data\s*:\s*text\s*\/\s*html)/i;
const UNSAFE_URL_ATTR_FALLBACK_PATTERN =
  /\s*(?:href|src)\s*=\s*(?:"\s*(?:javascript\s*:|data\s*:\s*text\s*\/\s*html)[^"]*"|'\s*(?:javascript\s*:|data\s*:\s*text\s*\/\s*html)[^']*|(?:javascript\s*:|data\s*:\s*text\s*\/\s*html)[^ \t\r\n>]*)/gi;

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
  sanitizeConfig: SanitizerConfig | ((toolName: string) => SanitizerConfig | undefined),
  globalSanitizer: SanitizerConfig = {} as SanitizerConfig
): Array<Pick<SavedData, 'data' | 'tool'>> => {
  return blocksData.map((block) => {
    const toolConfig = _.isFunction(sanitizeConfig) ? sanitizeConfig(block.tool) : sanitizeConfig;
    const rules: DeepSanitizerRule = (toolConfig ?? {}) as SanitizerConfig;

    if (_.isObject(rules) && _.isEmpty(rules) && _.isEmpty(globalSanitizer)) {
      return block;
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
  const sanitizerConfig = {
    tags: customConfig,
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
  dataToSanitize: object | string,
  rules: DeepSanitizerRule,
  globalRules: SanitizerConfig
): object | string => {
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

  if (_.isObject(dataToSanitize)) {
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
  if (_.isString(dataToSanitize)) {
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
  array: Array<object | string>,
  ruleForItem: DeepSanitizerRule,
  globalRules: SanitizerConfig
): Array<object | string> => {
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
  object: object,
  rules: DeepSanitizerRule | Record<string, DeepSanitizerRule>,
  globalRules: SanitizerConfig
): object => {
  const cleanData: Record<string, unknown> = {};
  const objectRecord = object as Record<string, unknown>;

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
    const rulesRecord = _.isObject(rules) ? (rules as Record<string, DeepSanitizerRule>) : undefined;
    const ruleCandidate = rulesRecord?.[fieldName];
    const ruleForItem = ruleCandidate !== undefined && isRule(ruleCandidate)
      ? ruleCandidate
      : rules;

    cleanData[fieldName] = deepSanitize(currentIterationItem as object | string, ruleForItem as DeepSanitizerRule, globalRules);
  }

  return cleanData;
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
  const effectiveRule = getEffectiveRuleForString(rule, globalRules);

  if (effectiveRule) {
    const cleaned = clean(taintString, effectiveRule);

    return stripUnsafeUrls(applyAttributeOverrides(cleaned, effectiveRule));
  }

  if (!_.isEmpty(globalRules)) {
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
  return _.isObject(config) || _.isBoolean(config) || _.isFunction(config);
};

/**
 *
 * @param {string} value - HTML string to strip unsafe URLs from
 */
const hasUnsafeUrlProtocol = (value: string | null): boolean => {
  if (!value) {
    return false;
  }

  return UNSAFE_URL_PROTOCOL_PATTERN.test(value);
};

const stripUnsafeUrls = (value: string): string => {
  if (!value || value.indexOf('<') === -1) {
    return value;
  }

  if (typeof document !== 'undefined') {
    const template = document.createElement('template');

    template.innerHTML = value;

    const elements = template.content.querySelectorAll('[href],[src]');

    elements.forEach((element) => {
      ['href', 'src'].forEach((attribute) => {
        const attrValue = element.getAttribute(attribute);

        if (hasUnsafeUrlProtocol(attrValue)) {
          element.removeAttribute(attribute);
        }
      });
    });

    return template.innerHTML;
  }

  return value.replace(UNSAFE_URL_ATTR_FALLBACK_PATTERN, '');
};

/**
 *
 * @param {SanitizerConfig} config - sanitizer config to clone
 */
const cloneSanitizerConfig = (config: SanitizerConfig): SanitizerConfig => {
  if (_.isEmpty(config)) {
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

  if (_.isFunction(rule)) {
    return wrapFunctionRule(rule as SanitizerFunctionRule);
  }

  if (_.isString(rule)) {
    return rule;
  }

  if (_.isObject(rule)) {
    return _.deepMerge({}, rule as Record<string, unknown>) as SanitizerRule;
  }

  return rule;
};

/**
 *
 * @param {SanitizerConfig} globalRules - global sanitizer config
 * @param {SanitizerConfig} fieldRules - field-specific sanitizer config
 */
const mergeTagRules = (globalRules: SanitizerConfig, fieldRules: SanitizerConfig): SanitizerConfig => {
  if (_.isEmpty(globalRules)) {
    return cloneSanitizerConfig(fieldRules);
  }

  const merged: SanitizerConfig = {} as SanitizerConfig;

  for (const tag in globalRules) {
    if (!Object.prototype.hasOwnProperty.call(globalRules, tag)) {
      continue;
    }

    const globalValue = globalRules[tag];
    const fieldValue = fieldRules ? fieldRules[tag] : undefined;

    if (_.isFunction(fieldValue)) {
      merged[tag] = cloneTagConfig(fieldValue as SanitizerRule);

      continue;
    }

    if (_.isFunction(globalValue)) {
      merged[tag] = cloneTagConfig(globalValue as SanitizerRule);

      continue;
    }

    if (_.isObject(globalValue) && _.isObject(fieldValue)) {
      merged[tag] = _.deepMerge({}, fieldValue as SanitizerConfig, globalValue as SanitizerConfig);

      continue;
    }

    if (fieldValue !== undefined) {
      merged[tag] = cloneTagConfig(fieldValue as SanitizerRule);

      continue;
    }

    merged[tag] = cloneTagConfig(globalValue as SanitizerRule);
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
  if (_.isObject(rule) && !_.isFunction(rule)) {
    return mergeTagRules(globalRules, rule as SanitizerConfig);
  }

  if (rule === false) {
    return {} as SanitizerConfig;
  }

  if (_.isEmpty(globalRules)) {
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
  if (_.isEmpty(globalConfig)) {
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

      if (_.isFunction(sourceValue)) {
        base[tag] = sourceValue;

        continue;
      }

      if (sourceValue === true && _.isFunction(targetValue)) {
        continue;
      }

      if (sourceValue === true) {
        const targetIsPlainObject = _.isObject(targetValue) && !_.isFunction(targetValue);

        base[tag] = targetIsPlainObject
          ? _.deepMerge({}, targetValue as SanitizerConfig)
          : cloneTagConfig(sourceValue as SanitizerRule);

        continue;
      }

      if (_.isObject(sourceValue) && _.isObject(targetValue)) {
        base[tag] = _.deepMerge({}, targetValue as SanitizerConfig, sourceValue as SanitizerConfig);

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

  const entries = Object.entries(rules).filter(([, value]) => _.isFunction(value));

  if (entries.length === 0) {
    return html;
  }

  const template = document.createElement('template');

  template.innerHTML = html;

  entries.forEach(([tag, rule]) => {
    const elements = template.content.querySelectorAll(tag);

    elements.forEach((element) => {
      const ruleResult = (rule as (el: Element) => SanitizerRule)(element);

      if (_.isBoolean(ruleResult) || _.isFunction(ruleResult) || ruleResult == null) {
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

        if (_.isString(attrRule)) {
          element.setAttribute(attr, attrRule);
        }
      }
    });
  });

  return template.innerHTML;
};
