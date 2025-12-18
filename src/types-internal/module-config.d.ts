import { BlokConfig } from '../../types/index';
import { BlokEventMap } from '../components/events';
import { EventsDispatcher } from '../components/utils/events';

/**
 * Describes object passed to Blok modules constructor
 */
export interface ModuleConfig {
  config: BlokConfig;
  eventsDispatcher: EventsDispatcher<BlokEventMap>;
}
