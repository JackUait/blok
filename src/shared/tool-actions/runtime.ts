import { isObject } from '../../components/utils/type-guards';
import { composeBaseSanitizeConfig } from '../sanitize-schema';

import type { SanitizerConfig } from '../../../types';
import type { InsertSpec } from '../../../types/agent';
import type { ToolActionImpl } from '../../../types/tools/tool-description';

export interface ToolRuntime {
  name: string;
  sanitize: SanitizerConfig;
  normalize?(data: Record<string, unknown>): Record<string, unknown>;
  defaultChildren?: InsertSpec[];
  actions: Readonly<Record<string, ToolActionImpl>>;
}

export type ToolRuntimeRegistry = ReadonlyMap<string, ToolRuntime>;

export interface RuntimeBlockInput {
  name: string;
  ownSanitize: SanitizerConfig;
  inlineSanitize: SanitizerConfig[];
  normalize?: ToolRuntime['normalize'];
  defaultChildren?: InsertSpec[];
  actions?: Readonly<Record<string, ToolActionImpl>>;
}

export const composeToolSanitize = (own: SanitizerConfig, inline: SanitizerConfig[]): SanitizerConfig => {
  const base = composeBaseSanitizeConfig(inline);

  if (Object.keys(own).length === 0) {
    return base;
  }

  const composed: SanitizerConfig = {};

  for (const [field, rule] of Object.entries(own)) {
    composed[field] = isObject(rule) ? Object.assign({}, base, rule) : rule;
  }

  return composed;
};

export const buildToolRuntimes = (blocks: RuntimeBlockInput[]): ToolRuntimeRegistry => new Map(
  blocks.map((block): [string, ToolRuntime] => [block.name, {
    name: block.name,
    sanitize: composeToolSanitize(block.ownSanitize, block.inlineSanitize),
    ...(block.normalize === undefined ? {} : { normalize: block.normalize }),
    ...(block.defaultChildren === undefined ? {} : { defaultChildren: block.defaultChildren }),
    actions: block.actions ?? {},
  }])
);
