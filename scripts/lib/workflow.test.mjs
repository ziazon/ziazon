import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { test } from 'node:test';

const root = new URL('../../', import.meta.url);
test('monthly workflow replaces daily stats workflow with pinned, guarded monthly sequence', async () => {
  const workflow = await readFile(new URL('.github/workflows/profile-monthly.yml', root), 'utf8');
  await assert.rejects(access(new URL('.github/workflows/profile-stats.yml', root)));
  for (const text of ['name: Monthly profile update', "cron: '17 12 1 * *'", 'type: boolean', 'default: true', 'Run every step but publish nothing', 'contents: write', 'group: profile-monthly', 'cancel-in-progress: false', 'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1', 'actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0', 'node-version: 24', '[ -z "$PROFILE_STATS_TOKEN" ]', '[ -z "$CLAUDE_CODE_OAUTH_TOKEN" ]', 'npm test', 'npm run generate', 'npm install -g @anthropic-ai/claude-code@2.1.295', 'node scripts/monthly-update.mjs', 'github-actions[bot]', '41898282+github-actions[bot]@users.noreply.github.com', 'PROFILE_TOKEN: ${{ secrets.PROFILE_STATS_TOKEN }}', "DRY_RUN: ${{ github.event_name == 'workflow_dispatch' && inputs.dry_run }}"]) assert.ok(workflow.includes(text), text);
  const order = ['Require', 'npm test', 'npm run generate', 'npm install -g', 'git config', 'node scripts/monthly-update.mjs'].map(s => workflow.indexOf(s));
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
});
test('package exposes monthly command without npm dependencies', async () => {
  const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
  assert.equal(pkg.scripts.monthly, 'node scripts/monthly-update.mjs');
  assert.equal(Object.keys(pkg.dependencies ?? {}).length, 0);
  assert.equal(Object.keys(pkg.devDependencies ?? {}).length, 0);
});

test('monthly job only runs on master', async () => {
  const workflow = await readFile(new URL('.github/workflows/profile-monthly.yml', root), 'utf8');
  assert.match(workflow, /jobs:\n  monthly:\n    if: github\.ref == 'refs\/heads\/master'\n/);
});
