/** Reads the BLOK_EVAL_* variables run.mjs sets; a missing one is a setup error, not a silent default. */
export const env = (key: string): string => {
  const value = process.env[key];

  if (value === undefined || value === '') {
    throw new Error(`${key} is required; run through test/evals/agent/runner/run.mjs`);
  }

  return value;
};

export const oneOf = <T extends string>(key: string, allowed: readonly T[]): T => {
  const value = env(key);
  const match = allowed.find((item) => item === value);

  if (match === undefined) {
    throw new Error(`${key} must be one of ${allowed.join(', ')}; got ${value}`);
  }

  return match;
};

export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export const SCHEMAS = ['envelope', 'full'] as const;
