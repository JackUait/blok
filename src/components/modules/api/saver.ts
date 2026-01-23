import type { OutputData } from '../../../../types';
import type { Saver } from '../../../../types/api';
import { Module } from '../../__module';
import { logLabeled } from '../../utils';

/**
 * @class SaverAPI
 * provides with methods to save data
 */
export class SaverAPI extends Module {
  /**
   * Available methods
   * @returns {Saver}
   */
  public get methods(): Saver {
    return {
      save: (): Promise<OutputData> => this.save(),
    };
  }

  /**
   * Return Blok's data
   * @returns {OutputData}
   */
  public async save(): Promise<OutputData> {
    const errorText = 'Blok\'s content can not be saved in read-only mode';

    if (this.Blok.ReadOnly.isEnabled) {
      logLabeled(errorText, 'warn');

      throw new Error(errorText);
    }

    const savedData = await this.Blok.Saver.save();

    if (savedData !== undefined) {
      return savedData;
    }

    const lastError = this.Blok.Saver.getLastSaveError?.();

    if (lastError instanceof Error) {
      throw lastError;
    }

    const errorMessage = lastError !== undefined
      // eslint-disable-next-line @typescript-eslint/no-base-to-string
      ? String(lastError)
      : 'Blok\'s content can not be saved because collecting data failed';

    throw new Error(errorMessage);
  }
}
