/**
 * Type-level tests for tools-entry.d.ts declarations.
 * Run with: tsc --noEmit --strict test/unit/tools/tools-entry-typecheck.ts
 *
 * This file is NOT executed — it only needs to compile.
 * Each assertion is a type that would cause a compile error if the
 * declaration is wrong.
 */

import type { defaultBlockTools } from '../../../types/tools-entry';

// defaultBlockTools must include 'database' and 'database-row' entries
const _db: typeof defaultBlockTools.database = {} as const;
const _dbRow: typeof defaultBlockTools['database-row'] = {} as const;

// Suppress unused variable warnings
void _db;
void _dbRow;
