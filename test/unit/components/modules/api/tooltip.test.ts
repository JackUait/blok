import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import TooltipAPI from '../../../../../src/components/modules/api/tooltip';
import EventsDispatcher from '../../../../../src/components/utils/events';
import type { ModuleConfig } from '../../../../../src/types-internal/module-config';
import type { BlokConfig } from '../../../../../types';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';
import type { BlokEventMap } from '../../../../../src/components/events';

const { showMock, hideMock, onHoverMock } = vi.hoisted(() => ({
  showMock: vi.fn(),
  hideMock: vi.fn(),
  onHoverMock: vi.fn(),
}));

vi.mock('../../../../../src/components/utils/tooltip', () => ({
  show: showMock,
  hide: hideMock,
  onHover: onHoverMock,
}));

const createTooltipApi = (): TooltipAPI => {
  const eventsDispatcher = new EventsDispatcher<BlokEventMap>();
  const moduleConfig: ModuleConfig = {
    config: {} as BlokConfig,
    eventsDispatcher,
  };

  const tooltipApi = new TooltipAPI(moduleConfig);

  tooltipApi.state = {} as BlokModules;

  return tooltipApi;
};

describe('TooltipAPI', () => {
  let tooltipApi: TooltipAPI;
  let element: HTMLElement;

  beforeEach(() => {
    tooltipApi = createTooltipApi();
    element = document.createElement('div');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    showMock.mockReset();
    hideMock.mockReset();
    onHoverMock.mockReset();
  });

  it('exposes show, hide and onHover helpers through methods getter', () => {
    const { show, hide, onHover } = tooltipApi.methods;
    const options = { placement: 'top' };

    expect(show).toEqual(expect.any(Function));
    expect(hide).toEqual(expect.any(Function));
    expect(onHover).toEqual(expect.any(Function));

    show(element, 'text', options);
    hide();
    onHover(element, 'hover', options);

    expect(showMock).toHaveBeenCalledWith(element, 'text', options);
    expect(hideMock).toHaveBeenCalledWith();
    expect(onHoverMock).toHaveBeenCalledWith(element, 'hover', options);
  });

  it('delegates show() calls to tooltip utility', () => {
    const options = { delay: 100 };

    tooltipApi.show(element, 'content', options);

    expect(showMock).toHaveBeenCalledTimes(1);
    expect(showMock).toHaveBeenCalledWith(element, 'content', options);
  });

  it('delegates hide() calls to tooltip utility', () => {
    tooltipApi.hide();

    expect(hideMock).toHaveBeenCalledTimes(1);
    expect(hideMock).toHaveBeenCalledWith();
  });

  it('delegates onHover() calls to tooltip utility', () => {
    const contentNode = document.createElement('span');
    const options = { delay: 50 };

    tooltipApi.onHover(element, contentNode, options);

    expect(onHoverMock).toHaveBeenCalledTimes(1);
    expect(onHoverMock).toHaveBeenCalledWith(element, contentNode, options);
  });
});
