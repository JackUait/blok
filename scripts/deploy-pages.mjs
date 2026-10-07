#!/usr/bin/env node
// Deploys this run's Pages artifact, like actions/deploy-pages, but with a
// build version unique to the run.
//
// Pages treats `pages_build_version` as the deployment's id. A second deploy
// with an id it already served is acknowledged and publishes nothing, and
// deploy-pages always sends GITHUB_SHA: a release dispatch on the commit the
// main push already deployed was silently dropped. A step `env:` cannot
// override GITHUB_SHA (the runner rewrites GITHUB_* after reading it), and
// Pages answers 404 to a version that is not a real commit. So the version is
// a commit made for this run: the run commit's tree, the run commit as its
// parent, referenced by no branch or tag.
//
// Env: GITHUB_REPOSITORY, GITHUB_SHA, GITHUB_RUN_ID, GITHUB_RUN_ATTEMPT,
// GITHUB_API_URL, GH_TOKEN (contents: write, for the commit), ARTIFACT_ID,
// and the OIDC request pair the runner sets under `id-token: write`.
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Spelled as Pages spells them; the same sets as deploy-pages' deployment.js.
const FINAL_ERRORS = new Set(['deployment_failed', 'deployment_content_failed', 'deployment_cancelled', 'deployment_lost']);
// deploy-pages' defaults: a 10-minute cap and 10 failed polls.
const TIMEOUT_MS = 600_000;
const MAX_POLL_ERRORS = 10;
const POLL_MS = 5_000;

/** @typedef {(method: string, path: string, body?: Record<string, unknown>) => Promise<any>} Api */

/** A GitHub REST client whose errors name the request and carry the response body. */
export const createApi = ({ baseUrl, token, fetchImpl = fetch }) => async (method, path, body) => {
  const response = await fetchImpl(`${baseUrl}${path}`, {
    method,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'x-github-api-version': '2022-11-28',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${path} answered ${response.status}: ${text}`);
  return text ? JSON.parse(text) : {};
};

/** The job's OIDC token, fetched as @actions/core getIDToken() does with no audience. */
export const requestIdToken = async ({ url, token, fetchImpl = fetch }) => {
  if (!url || !token) throw new Error('No OIDC request URL: the deploy job needs `id-token: write`.');
  const response = await fetchImpl(url, { headers: { accept: 'application/json', authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`OIDC token request answered ${response.status}: ${await response.text()}`);
  const { value } = await response.json();
  if (!value) throw new Error('OIDC token response had no value');
  return value;
};

/**
 * @param {{ api: Api, repo: string, sha: string, artifactId: string, oidcToken: string, runId: string,
 *   runAttempt?: string, onDeployment?: (id: string) => void, timeoutMs?: number, now?: () => number,
 *   sleep?: (ms: number) => Promise<void>, log?: (line: string) => void }} options
 */
export const deployPages = async ({
  api,
  repo,
  sha,
  artifactId,
  oidcToken,
  runId,
  runAttempt = '',
  onDeployment = () => {},
  timeoutMs = TIMEOUT_MS,
  now = Date.now,
  sleep = (ms) => new Promise((done) => setTimeout(done, ms)),
  log = (line) => process.stdout.write(`${line}\n`),
}) => {
  const { tree } = await api('GET', `/repos/${repo}/git/commits/${sha}`);
  const { sha: buildVersion } = await api('POST', `/repos/${repo}/git/commits`, {
    tree: tree.sha,
    parents: [sha],
    message: `Pages deployment of ${sha} (run ${runId}, attempt ${runAttempt})`,
  });
  log(`build version: ${buildVersion} (a commit made for this run on top of ${sha})`);

  const created = await api('POST', `/repos/${repo}/pages/deployments`, {
    artifact_id: Number(artifactId),
    pages_build_version: buildVersion,
    oidc_token: oidcToken,
  });
  // Poll what Pages recorded, not what was sent.
  const id = String(created.id);
  log(`Pages deployment ${id}, page_url ${created.page_url}`);
  onDeployment(id);

  const start = now();
  let errors = 0;
  for (;;) {
    await sleep(POLL_MS);
    let status = 'unknown_status';
    try {
      ({ status } = await api('GET', `/repos/${repo}/pages/deployments/${id}`));
    } catch (error) {
      errors += 1;
      log(`status poll failed (${errors}/${MAX_POLL_ERRORS}): ${error.message}`);
      if (errors >= MAX_POLL_ERRORS) {
        await api('POST', `/repos/${repo}/pages/deployments/${id}/cancel`);
        throw new Error(`Gave up on Pages deployment ${id} after ${errors} failed status polls`);
      }
    }
    log(`status: ${status}`);
    if (status === 'succeed') return { id, pageUrl: created.page_url, buildVersion };
    if (FINAL_ERRORS.has(status)) throw new Error(`Pages deployment ${id} ended in ${status}`);
    if (now() - start >= timeoutMs) {
      await api('POST', `/repos/${repo}/pages/deployments/${id}/cancel`);
      throw new Error(`Pages deployment ${id} timed out after ${timeoutMs} ms; cancelled it`);
    }
  }
};

const main = async () => {
  const env = process.env;
  const api = createApi({ baseUrl: env.GITHUB_API_URL ?? 'https://api.github.com', token: env.GH_TOKEN ?? '' });
  const repo = env.GITHUB_REPOSITORY ?? '';
  let deploymentId = null;
  // deploy-pages cancels on these too: workflow concurrency cancels runs.
  const cancel = async () => {
    if (deploymentId) await api('POST', `/repos/${repo}/pages/deployments/${deploymentId}/cancel`).catch(() => {});
    process.exit(1);
  };
  process.on('SIGINT', cancel);
  process.on('SIGTERM', cancel);

  const { pageUrl } = await deployPages({
    api,
    repo,
    sha: env.GITHUB_SHA ?? '',
    artifactId: env.ARTIFACT_ID ?? '',
    oidcToken: await requestIdToken({ url: env.ACTIONS_ID_TOKEN_REQUEST_URL, token: env.ACTIONS_ID_TOKEN_REQUEST_TOKEN }),
    runId: env.GITHUB_RUN_ID ?? '',
    runAttempt: env.GITHUB_RUN_ATTEMPT ?? '',
    onDeployment: (id) => {
      deploymentId = id;
    },
  });
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `page_url=${pageUrl}\n`);
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
