import type { SanitizerConfig } from '../../types';
import type { TagConfig } from '../../types/configs/sanitizer-config';
import { isSafeAttribute } from './sanitize-rules';

type AttributeMap = { [attr: string]: boolean | string };

const isAttributeMap = (rule: unknown): rule is AttributeMap =>
  typeof rule === 'object' && rule !== null && !Array.isArray(rule);

const isTagFunction = (rule: unknown): rule is (el: Element) => TagConfig => typeof rule === 'function';

/**
 * Composes a base sanitizer config from a list of per-tool configs using the
 * exact merge semantics of `BlockToolAdapter.baseSanitizeConfig`: a plain
 * later-wins `Object.assign` fold (inline tools first, then tunes). Function
 * rules are carried by reference; rules for the same tag are replaced, never
 * deep-merged.
 * @param configs - sanitize configs in composition order
 * @returns composed base sanitizer config
 */
export function composeBaseSanitizeConfig(configs: SanitizerConfig[]): SanitizerConfig {
  const baseConfig: SanitizerConfig = {};

  configs.forEach((config) => Object.assign(baseConfig, config));

  return baseConfig;
}

/**
 * The element's attributes a rule lets through: `true` keeps the safe ones, as a bare `true` rule does.
 * Strings become `true` because a function result forces string values onto the element.
 */
const allowedBy = (rule: AttributeMap | true, element: Element): AttributeMap => Object.fromEntries(
  Array.from(element.attributes).flatMap(({ name, value }): Array<[string, true]> => {
    if (rule === true) {
      return isSafeAttribute(name) ? [[name, true]] : [];
    }
    const attrRule = Object.hasOwn(rule, name) ? rule[name] : undefined;

    return attrRule === true || (typeof attrRule === 'string' && attrRule === value) ? [[name, true]] : [];
  })
);

/**
 * One tag ruled by both the block tool (own) and an inline tool or tune (base).
 * An inline tool that lists attributes only claims an element that carries one of them;
 * any other element gets the block's verdict, so a bare `<span>` still unwraps.
 * An inline tool whose rule is `true` claims every element of the tag.
 */
const combinedTagRule = (own: AttributeMap | ((el: Element) => TagConfig), base: AttributeMap | true) => (element: Element): TagConfig => {
  const claimed = allowedBy(base, element);
  const ownVerdict: TagConfig = typeof own === 'function' ? own(element) ?? {} : allowedBy(own, element);

  if ((base !== true && Object.keys(claimed).length === 0) || ownVerdict === true) {
    return ownVerdict;
  }

  return ownVerdict === false ? claimed : { ...ownVerdict, ...claimed };
};

/** What an inline tool's rule claims on a shared tag: nothing for a function or an attribute-less rule. */
const claimOf = (rule: unknown): AttributeMap | true | undefined => {
  if (rule === true) {
    return true;
  }

  return isAttributeMap(rule) && Object.values(rule).some(value => value !== false) ? rule : undefined;
};

/**
 * A block field's object rule with the inline tools' and tunes' rules added.
 * An own `true`/`false`, and a base function or attribute-less rule, keep the block's rule as before.
 * @param base - the composed inline-tool and tune rules
 * @param own - the block tool's rule for one field
 */
export function composeFieldSanitize<Rule extends Record<string, unknown>>(base: SanitizerConfig, own: Rule): SanitizerConfig & Rule {
  const composed: SanitizerConfig & Rule = Object.assign({}, base, own);

  for (const [tag, ownRule] of Object.entries(own)) {
    const claim = claimOf(Object.hasOwn(base, tag) ? base[tag] : undefined);

    if (claim !== undefined && (isTagFunction(ownRule) || isAttributeMap(ownRule))) {
      Object.assign(composed, { [tag]: combinedTagRule(ownRule, claim) });
    }
  }

  return composed;
}
