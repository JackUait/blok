import type { BlokUploader } from '../../../types/configs/uploader';
import type { BookmarkMeta } from '../../../types/tools/bookmark';
import type { PageIcon } from '../../../types/tools/page';

export type UploaderService = Pick<BlokUploader, 'uploadByUrl'>;

export type LinkMetadataService = {
  fetch(url: string): Promise<BookmarkMeta>;
};

export type PageBackendService = {
  rename(input: { blockId: string; title: string }): Promise<unknown>;
  setIcon(input: { blockId: string; icon: PageIcon | null }): Promise<unknown>;
};
