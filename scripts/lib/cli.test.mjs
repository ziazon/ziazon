import assert from 'node:assert/strict';
import { test } from 'node:test';
import { main } from './cli.mjs';

const env = { CLAUDE_CODE_OAUTH_TOKEN: 'oauth-SENTINEL', PROFILE_TOKEN: 'profile-SENTINEL', GITHUB_REPOSITORY: 'ziazon/ziazon', GITHUB_RUN_ID: '123', DRY_RUN: 'true' };
test('CLI requires all four env names, reports one line, and does not invoke the runner', async () => {
  const errors = [];
  let called = false;
  const code = await main({ env: {}, run: async () => { called = true; }, error: message => errors.push(message) });
  assert.equal(code, 1);
  assert.equal(called, false);
  assert.deepEqual(errors, ['Missing required environment: CLAUDE_CODE_OAUTH_TOKEN, PROFILE_TOKEN, GITHUB_REPOSITORY, GITHUB_RUN_ID.']);
});
test('CLI passes config with dry-run enabled only for literal true', async () => {
  for (const [value, expected] of [['true', true], ['false', false], ['', false]]) {
    let options;
    assert.equal(await main({ env: { ...env, DRY_RUN: value }, run: async deps => { options = deps; } }), 0);
    assert.deepEqual(options, { oauthToken: env.CLAUDE_CODE_OAUTH_TOKEN, token: env.PROFILE_TOKEN, repository: env.GITHUB_REPOSITORY, runId: '123', dryRun: expected });
  }
});
test('CLI error is one redacted line and exits 1', async () => {
  const errors = [];
  assert.equal(await main({ env, run: async () => { throw new Error('Failed oauth-SENTINEL\nprofile-SENTINEL'); }, error: message => errors.push(message) }), 1);
  assert.deepEqual(errors, ['Failed [redacted] [redacted]']);
});
