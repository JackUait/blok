import type { PageIcon } from '../../../types/tools/page';
import type { ToolActionImpl } from '../../../types/tools/tool-description';
import type { PageBackendService } from './services';

function assertPageBackend(value: unknown): asserts value is PageBackendService {
  if (typeof value !== 'object' || value === null
    || !('rename' in value) || typeof value.rename !== 'function'
    || !('setIcon' in value) || typeof value.setIcon !== 'function') {
    throw new Error('pageBackend must provide rename and setIcon.');
  }
}

const rename: ToolActionImpl<{ id: string; title: string }> = {
  prepare: ({ services }, args) => {
    assertPageBackend(services.pageBackend);

    return services.pageBackend.rename({ blockId: args.id, title: args.title });
  },
  run: (_ctx, _args, prepared) => prepared,
};

const setIcon: ToolActionImpl<{ id: string; icon: PageIcon | null }> = {
  prepare: ({ services }, args) => {
    assertPageBackend(services.pageBackend);

    return services.pageBackend.setIcon({ blockId: args.id, icon: args.icon });
  },
  run: (_ctx, _args, prepared) => prepared,
};

export const PAGE_ACTION_HANDLERS: Readonly<Record<string, ToolActionImpl>> = {
  rename,
  setIcon,
};
