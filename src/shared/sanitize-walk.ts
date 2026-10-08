import type { SanitizerConfig, SanitizerRule } from '../../types';
import type { TagConfig } from '../../types/configs/sanitizer-config';
import { deepMerge } from '../components/utils/object';
import { isBoolean, isEmpty, isFunction, isObject, isString } from '../components/utils/type-guards';
import { isSafeAttribute, PLAINTEXT } from './sanitize-rules';

export type DeepSanitizerRule = SanitizerConfig | SanitizerRule;
export type DeepData = string | Record<string, unknown> | Array<DeepData> | null;
export type StringCleaner = (value: string, rule: DeepSanitizerRule, globalRules: SanitizerConfig) => string;
type SanitizerFunctionRule = (el: Element) => TagConfig;

// The serializer and server export use the same depth cap.
export const MAX_SANITIZE_DEPTH = 256;

export const isPlaintextRule = (rule: DeepSanitizerRule): boolean => {
  return rule === PLAINTEXT;
};

export const walkSanitize = (
  dataToSanitize: DeepData,
  rules: DeepSanitizerRule,
  globalRules: SanitizerConfig,
  clean: StringCleaner,
  depth = 0
): DeepData => {
  if (depth > MAX_SANITIZE_DEPTH) {
    return null;
  }

  if (Array.isArray(dataToSanitize)) {
    return dataToSanitize.map(item => walkSanitize(item, rules, globalRules, clean, depth + 1));
  }

  if (isObject(dataToSanitize)) {
    return cleanObject(dataToSanitize, rules, globalRules, clean, depth);
  }

  if (isString(dataToSanitize)) {
    return clean(dataToSanitize, rules, globalRules);
  }

  return dataToSanitize;
};

const cleanObject = (
  object: Record<string, unknown>,
  rules: DeepSanitizerRule | Record<string, DeepSanitizerRule>,
  globalRules: SanitizerConfig,
  clean: StringCleaner,
  depth: number
): Record<string, unknown> => {
  const cleanData: Record<string, DeepData> = {};
  const objectRecord = object;

  for (const fieldName in object) {
    if (!Object.prototype.hasOwnProperty.call(object, fieldName)) {
      continue;
    }

    const currentIterationItem = objectRecord[fieldName];
    const rulesRecord = isObject(rules) ? (rules as Record<string, DeepSanitizerRule>) : undefined;
    const ruleCandidate = rulesRecord?.[fieldName];
    const ruleForItem = ruleCandidate !== undefined && isRule(ruleCandidate)
      ? ruleCandidate
      : rules;

    cleanData[fieldName] = walkSanitize(currentIterationItem as DeepData, ruleForItem as DeepSanitizerRule, globalRules, clean, depth + 1);
  }

  return cleanData;
};

export const isRule = (config: DeepSanitizerRule): boolean => {
  return isObject(config) || isBoolean(config) || isFunction(config) || isPlaintextRule(config);
};

export const cloneSanitizerConfig = (config: SanitizerConfig): SanitizerConfig => {
  if (isEmpty(config)) {
    return {};
  }

  const cloned: SanitizerConfig = {};

  for (const tag in config) {
    if (!Object.prototype.hasOwnProperty.call(config, tag)) {
      continue;
    }

    cloned[tag] = cloneTagConfig(config[tag]);
  }

  return cloned;
};

export const wrapFunctionRule = (rule: SanitizerFunctionRule): SanitizerFunctionRule => {
  return function wrappedRule(this: unknown, element: Element): TagConfig {
    const result = rule.call(this, element);

    if (result == null) {
      return {};
    }

    return result;
  };
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

export const cloneTagConfig = (rule: SanitizerRule): SanitizerRule => {
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
    return deepMerge({}, rule as Record<string, unknown>);
  }

  return rule;
};

export const mergeTagRules = (globalRules: SanitizerConfig, fieldRules: SanitizerConfig): SanitizerConfig => {
  if (isEmpty(globalRules)) {
    return cloneSanitizerConfig(fieldRules);
  }

  const merged: SanitizerConfig = {};

  for (const tag in globalRules) {
    if (!Object.prototype.hasOwnProperty.call(globalRules, tag)) {
      continue;
    }

    const globalValue = globalRules[tag];
    const fieldValue = fieldRules ? fieldRules[tag] : undefined;

    // A global non-function rule overrides a tool's function rule.
    if (isFunction(fieldValue) && isFunction(globalValue)) {
      merged[tag] = cloneTagConfig(fieldValue);

      continue;
    }

    if (isFunction(globalValue)) {
      merged[tag] = cloneTagConfig(globalValue);

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

export const getEffectiveRuleForString = (
  rule: DeepSanitizerRule,
  globalRules: SanitizerConfig
): SanitizerConfig | null => {
  if (isObject(rule) && !isFunction(rule)) {
    return mergeTagRules(globalRules, rule as SanitizerConfig);
  }

  if (rule === false) {
    return {};
  }

  if (isEmpty(globalRules)) {
    return null;
  }

  return cloneSanitizerConfig(globalRules);
};
