export class ConvertConflictError extends Error {
  public constructor(public readonly blockId: string) {
    super(`Could not convert Block «${blockId}»: it is being edited by someone else. Nothing was changed.`);
  }
}
