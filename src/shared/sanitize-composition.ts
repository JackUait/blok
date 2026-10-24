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

/** Blok's own markers: an inline tool never claims them, whatever its rule says. */
const isBlokAttribute = (name: string): boolean => name.toLowerCase().startsWith('data-blok-');

/**
 * The element's attributes an inline tool's rule claims: `true` claims the safe ones, as a bare `true` rule does.
 * Strings become `true`; the block's verdict is spread over this, so its forced strings and checks still win.
 */
const claimedBy = (claim: AttributeMap | true, element: Element): AttributeMap => Object.fromEntries(
  Array.from(element.attributes).flatMap(({ name, value }): Array<[string, true]> => {
    if (isBlokAttribute(name)) {
      return [];
    }
    if (claim === true) {
      return isSafeAttribute(name) ? [[name, true]] : [];
    }
    const attrRule = Object.hasOwn(claim, name) ? claim[name] : undefined;

    return attrRule === true || (typeof attrRule === 'string' && attrRule === value) ? [[name, true]] : [];
  })
);

/**
 * A block function rule with an inline tool's claim added.
 * A claim that lists attributes only takes an element that carries one of them, so a bare `<span>` still
 * gets the block's verdict (and unwraps). Where the block would unwrap, the claimed element is kept with
 * the claimed attributes only. Where both keep it, the block's verdict wins attribute by attribute.
 */
const combinedTagRule = (own: (el: Element) => TagConfig, claim: AttributeMap | true) => (element: Element): TagConfig => {
  const claimed = claimedBy(claim, element);
  const ownVerdict: TagConfig = own(element) ?? {};

  if ((claim !== true && Object.keys(claimed).length === 0) || ownVerdict === true) {
    return ownVerdict;
  }

  return ownVerdict === false ? claimed : { ...claimed, ...ownVerdict };
};

/**
 * A block object rule with an inline tool's attributes added. It stays an object, so a host global
 * sanitizer rule merges with it exactly as it did with the block's rule. The block's entries win.
 */
const mergedObjectRule = (own: AttributeMap, claim: AttributeMap): AttributeMap => ({
  ...Object.fromEntries(Object.entries(claim).filter(([name, rule]) => rule !== false && !isBlokAttribute(name))),
  ...own,
});

/** What an inline tool's rule claims on a shared tag: nothing for a function or an attribute-less rule. */
const claimOf = (rule: unknown): AttributeMap | true | undefined => {
  if (rule === true) {
    return true;
  }

  return isAttributeMap(rule) && Object.values(rule).some(value => value !== false) ? rule : undefined;
};

/**
 * A block field's object rule with the inline tools' and tunes' rules added.
 * An own `true`/`false`, a base function or attribute-less rule, and a base `true` on an own object keep the block's rule.
 * @param base - the composed inline-tool and tune rules
 * @param own - the block tool's rule for one field
 */
export function composeFieldSanitize<Rule extends Record<string, unknown>>(base: SanitizerConfig, own: Rule): SanitizerConfig & Rule {
  const composed: SanitizerConfig & Rule = Object.assign({}, base, own);

  for (const [tag, ownRule] of Object.entries(own)) {
    const claim = claimOf(Object.hasOwn(base, tag) ? base[tag] : undefined);

    if (claim !== undefined && isTagFunction(ownRule)) {
      Object.assign(composed, { [tag]: combinedTagRule(ownRule, claim) });
    }
    // A `true` claim on a block object rule is not added: no object can say "every safe attribute".
    if (isAttributeMap(claim) && isAttributeMap(ownRule)) {
      Object.assign(composed, { [tag]: mergedObjectRule(ownRule, claim) });
    }
  }

  return composed;
}
