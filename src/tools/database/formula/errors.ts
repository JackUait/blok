/**
 * Every compile error code. Each one has an English string under
 * `tools.database.formula.error.<code>`; errors.test.ts fails when one is missing.
 */
export const FORMULA_ERROR_CODES = [
  'unexpectedCharacter', 'unterminatedComment', 'unterminatedString',
  'unexpectedToken', 'expectedToken', 'expectedFunctionName', 'unexpectedEnd', 'propNeedsName',
  'unknownProperty', 'propertyNotUsable', 'negateNotNumber', 'lambdaKeywordOutside', 'unknownVariable',
  'branchTypesDiffer', 'cannotCompare', 'cannotAdd', 'operatorNotNumber', 'unknownFunction',
  'argumentCount', 'argumentCountRange', 'argumentCountAtLeast', 'argumentType', 'cannotConcat',
  'bindingName', 'pairedArguments', 'listExpected', 'conditionNotBoolean',
  'unknownRelatedProperty', 'circularReference', 'tooDeep',
] as const;

export type FormulaErrorCode = typeof FORMULA_ERROR_CODES[number];

export type FormulaErrorParams = Record<string, string | number>;

export interface FormulaError {
  /** English, for logs and tests. Show `code` + `params` through i18n instead. */
  message: string;
  code: FormulaErrorCode;
  params: FormulaErrorParams;
  start: number;
  end: number;
}

export class FormulaFailure extends Error {
  constructor(
    readonly code: FormulaErrorCode,
    readonly params: FormulaErrorParams,
    message: string,
    readonly start: number,
    readonly end: number
  ) {
    super(message);
  }

  toError(): FormulaError {
    return { message: this.message, code: this.code, params: this.params, start: this.start, end: this.end };
  }
}

/** The i18n key of an error code. */
export const formulaErrorKey = (code: FormulaErrorCode): string => `tools.database.formula.error.${code}`;
