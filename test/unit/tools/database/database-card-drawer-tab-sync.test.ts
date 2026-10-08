import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DATA_ATTR } from '../../../../src/components/constants/data-attributes';
import { browserTabPlatform } from '../../../../src/components/modules/tabSync/platform';
import { SETTINGS_CHANNEL } from '../../../../src/components/modules/tabSync/settings-channel';
import { DatabaseCardDrawer } from '../../../../src/tools/database/database-card-drawer';

describe('DatabaseCardDrawer — nested editor and tab sync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  // The card body is part of the host's document, not a document of its own.
  // The timeout covers the drawer's cold import of the whole editor (~1.7s alone,
  // 3.0-3.9s in a full folder run); the default 5s cut it off under load.
  it('the nested card editor opens no tab-sync channel', async () => {
    const rawChannel = vi.spyOn(browserTabPlatform, 'rawChannel');
    const lock = vi.spyOn(browserTabPlatform, 'lock');
    const wrapper = document.createElement('div');

    document.body.appendChild(wrapper);

    const drawer = new DatabaseCardDrawer({
      wrapper,
      readOnly: false,
      titlePropertyId: 'prop-title',
      schema: [],
      onTitleChange: vi.fn(),
      onDescriptionChange: vi.fn(),
      onClose: vi.fn(),
    });

    drawer.open({ id: 'row-1', position: 'a0', properties: { 'prop-title': 'Card' } });

    await vi.waitFor(() => {
      expect(wrapper.querySelector(`[${DATA_ATTR.rendered}]`)).not.toBeNull();
    }, { timeout: 20000 });
    // TabSync.start runs right after the first render.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(rawChannel).not.toHaveBeenCalledWith(SETTINGS_CHANNEL);
    expect(lock).not.toHaveBeenCalled();
    drawer.destroy();
  }, 20000);
});
