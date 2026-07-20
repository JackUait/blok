/**
 * Internal contract for the first-party framework adapters
 * (@bloklabs/react, @bloklabs/vue, @bloklabs/angular).
 *
 * These are the shared utilities the adapters build on so that every
 * framework exposes the IDENTICAL blocks API over one implementation.
 * This entry is published as `@bloklabs/core/adapters` but carries NO semver
 * guarantees — it exists solely so the adapter packages can externalize
 * the core instead of bundling (and thus duplicating) it.
 */
export * from './components/utils/blocks-api';
export * from './components/utils/blocks-tree';
export * from './components/utils/readonly-config';
export * from './shared/deep-equal';
export * from './shared/output-data';
export * from './shared/prop-schema';
export * from './tools/nested-blocks';
export { DATA_ATTR } from './components/constants/data-attributes';
