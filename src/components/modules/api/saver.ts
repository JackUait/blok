import type { Saver } from '../../../../types/api';
import type { OutputData } from '../../../../types';
import * as _ from '../../utils';
import Module from '../../__module';

/**
 * @class SaverAPI
 * provides with methods to save data
 */
export default class SaverAPI extends Module {
  /**
   * Available methods
   *
   * @returns {Saver}
   */
  public get methods(): Saver {
    return {
      save: (): Promise<OutputData> => this.save(),
    };
  }

  /**
   * Return Editor's data
   *
   * @returns {OutputData}
   */
  public async save(): Promise<OutputData> {
    const errorText = 'Editor\'s content can not be saved in read-only mode';

    if (this.Editor.ReadOnly.isEnabled) {
      _.logLabeled(errorText, 'warn');

      throw new Error(errorText);
    }

    const savedData = await this.Editor.Saver.save();

    if (savedData !== undefined) {
      return savedData;
    }

    const lastError = this.Editor.Saver.getLastSaveError?.();

    if (lastError instanceof Error) {
      throw lastError;
    }

    const errorMessage = lastError !== undefined
      ? String(lastError)
      : 'Editor\'s content can not be saved because collecting data failed';

    throw new Error(errorMessage);
  }
}
