/* global __BLOK_OVERRIDE_VERSION__, __BLOK_BUILT_AT__ */
import * as core from '../../src/blok';
import * as tools from '../../src/tools/index';
import * as full from '../../src/full';
import * as markdown from '../../src/markdown/index';
import * as view from '../../src/view/index';
import * as migrate from '../../src/migrate/index';
import * as adapters from '../../src/adapters';
import * as icons from '../../src/icons/index';
import * as locales from '../../src/locales';

globalThis.__BLOK_DEV_OVERRIDE__ = {
  protocol: 1,
  version: __BLOK_OVERRIDE_VERSION__,
  builtAt: __BLOK_BUILT_AT__,
  entries: { core, tools, full, markdown, view, migrate, adapters, icons, locales },
};
