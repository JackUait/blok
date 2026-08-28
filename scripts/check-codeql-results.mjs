#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HIGH_SEVERITY_FLOOR = 7;

export function getBlockingCodeqlFindings(sarif) {
  const findings = [];

  for (const run of sarif.runs ?? []) {
    const rules = new Map(
      (run.tool?.driver?.rules ?? []).map((rule) => [rule.id, rule]),
    );

    for (const result of run.results ?? []) {
      const rule = rules.get(result.ruleId);
      const severity = Number(
        result.properties?.['security-severity']
          ?? rule?.properties?.['security-severity'],
      );

      if (Number.isFinite(severity) && severity >= HIGH_SEVERITY_FLOOR) {
        findings.push({
          ruleId: result.ruleId ?? 'unknown-rule',
          severity,
          message: result.message?.text ?? result.message?.markdown ?? 'No message',
        });
      }
    }
  }

  return findings;
}

function collectSarifFiles(path) {
  if (!existsSync(path)) {
    throw new Error(`CodeQL results path does not exist: ${path}`);
  }

  if (!statSync(path).isDirectory()) {
    return extname(path) === '.sarif' ? [path] : [];
  }

  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = join(path, entry.name);

    if (entry.isDirectory()) {
      return collectSarifFiles(entryPath);
    }

    return extname(entry.name) === '.sarif' ? [entryPath] : [];
  });
}

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);

if (isDirectRun) {
  const resultsPath = resolve(process.argv[2] ?? '../results');
  const files = collectSarifFiles(resultsPath);

  if (files.length === 0) {
    console.error(`No SARIF files found in ${resultsPath}`);
    process.exit(1);
  }

  const findings = files.flatMap((file) =>
    getBlockingCodeqlFindings(JSON.parse(readFileSync(file, 'utf8'))),
  );

  if (findings.length > 0) {
    for (const finding of findings) {
      console.error(`[${finding.ruleId}] severity ${finding.severity}: ${finding.message}`);
    }
    process.exit(1);
  }

  console.log('CodeQL found no high-severity security results.');
}
