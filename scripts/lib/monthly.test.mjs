import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MARKERS, joinReadme } from './readme.mjs';
import { runMonthly } from './monthly.mjs';

const current = { bio: 'I build.', blog: 'https://zia.saidi.pro', company: 'Fixture Company' };
const parts = { before: 'Hero\n', managed: '\nI build.\n', between: '\n', projects: '\n', after: '\nActivity\n' };
const original = joinReadme(parts);
const proposal = { managed: '\nI build software.\n', bio: 'I build software.', blog: current.blog, summary: 'Aligned with website.' };
function fixture({ draft = {}, stats = true, unsupported = [], factError = false, privateNames = ['fixture-private'], dryRun = false, unchanged = false, apiStatus } = {}) {
  const git = [], requests = [], writes = [], logs = [], claude = [];
  const deps = {
    token: 'profile-SENTINEL', oauthToken: 'oauth-SENTINEL', repository: 'fixture-owner/fixture-profile', runId: '123', dryRun,
    now: () => new Date('2026-11-19T12:00:00Z'),
    readFile: async () => original,
    writeFile: async (...args) => writes.push(args),
    log: message => logs.push(message),
    runGit: async args => { git.push(args); return { code: args.includes('--quiet') && stats ? 1 : 0, stdout: '' }; },
    runClaude: async call => {
      claude.push(call);
      const result = claude.length === 1 ? { ...(unchanged ? { ...proposal, managed: parts.managed, bio: current.bio, blog: current.blog } : proposal), ...draft } : { unsupported };
      return { code: 0, stdout: JSON.stringify({ result: factError && claude.length > 1 ? 'not JSON' : JSON.stringify(result) }) };
    },
    fetch: async (url, options = {}) => {
      requests.push([url, options]);
      if (url.startsWith('https://zia.saidi.pro/')) return { status: 200, text: async () => '<p>I build software.</p>' };
      if (options.method === 'PATCH') return { status: apiStatus ?? 200, json: async () => ({}) };
      if (options.method === 'POST') return { status: 201, json: async () => ({ html_url: 'https://github.com/fixture-owner/fixture-profile/pull/1' }) };
      let body;
      if (url === 'https://api.github.com/user') body = { ...current, owned_private_repos: privateNames.length };
      else if (url === 'https://api.github.com/orgs/awna-ai') body = { owned_private_repos: 0 };
      else if (url.includes('/contents/skills')) body = [{ type: 'dir' }];
      else if (url.includes('visibility=private')) body = privateNames.map(name => ({ name }));
      else if (url.includes('type=private')) body = [];
      else body = [];
      return { status: 200, headers: new Headers(), json: async () => body };
    },
  };
  return { deps, git, requests, writes, logs, claude };
}
const mutations = f => f.requests.filter(([, options]) => ['POST', 'PATCH'].includes(options.method));
test('private-name hit aborts before any git, README write, PR, PATCH, or log output', async () => {
  const f = fixture({ draft: { managed: 'New FIXTURE-PRIVATE project' }, privateNames: ['fixture-private'] });
  await assert.rejects(runMonthly(f.deps), { message: 'A private repository name appeared in managed (1 hits); nothing was published.' });
  assert.deepEqual(f.git, []);
  assert.deepEqual(f.writes, []);
  assert.deepEqual(mutations(f), []);
  assert.deepEqual(f.logs, []);
  assert.equal(f.claude.length, 1);
});
test('summary is guarded against private names too', async () => {
  const f = fixture({ draft: { summary: 'Updated fixture-private.' }, privateNames: ['fixture-private'] });
  await assert.rejects(runMonthly(f.deps), /private repository name appeared in summary/);
  assert.deepEqual(f.git, []);
  assert.deepEqual(mutations(f), []);
});
test('dry run prints diff, proposed fields, summary and all checks without any writes', async () => {
  const f = fixture({ dryRun: true, draft: { bio: '30 years', company: 'Changed' }, unsupported: ['30 years'] });
  await runMonthly(f.deps);
  assert.deepEqual(f.git, []);
  assert.deepEqual(f.writes, []);
  assert.deepEqual(mutations(f), []);
  const output = f.logs.join('\n');
  assert.doesNotMatch(output, /company|Changed/i);
  for (const phrase of ['--- a/README.md', '+++ b/README.md', '-I build.', '+I build software.', '30 years', 'not written in the facts', 'unsupported', 'Aligned with website.', 'https://zia.saidi.pro']) assert.ok(output.includes(phrase), phrase);
});
test('clean run stages README and assets, commits fixed body, pushes master, then patches changed bio only', async () => {
  const f = fixture();
  await runMonthly(f.deps);
  assert.deepEqual(f.git, [['add', 'README.md', 'assets'], ['diff', '--cached', '--quiet'], ['commit', '-m', 'chore: monthly profile update (2026-11)', '-m', 'Managed block, projects list and bio refreshed from zia.saidi.pro.'], ['push', 'origin', 'HEAD:master']]);
  assert.equal(f.writes.length, 1);
  assert.equal(f.writes[0][0], 'README.md');
  assert.equal(f.writes[0][1], joinReadme({ ...parts, managed: proposal.managed }));
  const [[url, options]] = mutations(f);
  assert.equal(url, 'https://api.github.com/user');
  assert.equal(options.method, 'PATCH');
  assert.deepEqual(JSON.parse(options.body), { bio: proposal.bio });
});
test('only changed blog is patched; company is never patched', async () => {
  const f = fixture({ draft: { bio: current.bio, blog: 'https://zia.saidi.pro/about' } });
  await runMonthly(f.deps);
  assert.deepEqual(JSON.parse(mutations(f)[0][1].body), { blog: 'https://zia.saidi.pro/about' });
});
test('README-only changes need no PATCH', async () => {
  const f = fixture({ draft: { bio: current.bio } });
  await runMonthly(f.deps);
  assert.deepEqual(mutations(f), []);
});
test('problem run publishes stats first, then review branch and PR, and fails with review URL', async () => {
  const f = fixture({ draft: { company: 'Changed' }, unsupported: ['unsupported claim'] });
  await assert.rejects(runMonthly(f.deps), /Opened https:\/\/github.com\/fixture-owner\/fixture-profile\/pull\/1 for review: 1 checks did not pass\./);
  assert.deepEqual(f.git, [['add', 'assets'], ['diff', '--cached', '--quiet'], ['commit', '-m', 'chore: refresh profile stats'], ['push', 'origin', 'HEAD:master'], ['switch', '-c', 'profile-update/2026-11-123'], ['add', 'README.md'], ['commit', '-m', 'chore: monthly profile update (2026-11)', '-m', 'Managed block, projects list and bio refreshed from zia.saidi.pro.'], ['push', 'origin', 'HEAD:profile-update/2026-11-123']]);
  const [[url, options]] = mutations(f);
  assert.equal(url, 'https://api.github.com/repos/fixture-owner/fixture-profile/pulls');
  const pr = JSON.parse(options.body);
  assert.equal(pr.title, 'Monthly profile update 2026-11 needs review');
  assert.equal(pr.base, 'master');
  assert.equal(pr.head, 'profile-update/2026-11-123');
  assert.doesNotMatch(pr.body, /company|Changed/i);
  for (const phrase of ['Aligned with website.', 'unsupported claim', proposal.bio, current.blog]) assert.ok(pr.body.includes(phrase));
});
test('unparseable fact check becomes a review problem instead of crashing before PR', async () => {
  const f = fixture({ factError: true, stats: false });
  await assert.rejects(runMonthly(f.deps), /Opened .*1 checks did not pass/);
  assert.match(JSON.parse(mutations(f)[0][1].body).body, /Fact check.*valid/i);
});
test('unchanged profile commits only stats, skips fact check, PR and PATCH', async () => {
  const f = fixture({ unchanged: true });
  await runMonthly(f.deps);
  assert.deepEqual(f.git, [['add', 'assets'], ['diff', '--cached', '--quiet'], ['commit', '-m', 'chore: refresh profile stats'], ['push', 'origin', 'HEAD:master']]);
  assert.equal(f.claude.length, 1);
  assert.deepEqual(f.writes, []);
  assert.deepEqual(mutations(f), []);
});
test('unchanged profile and unchanged stats commit nothing', async () => {
  const f = fixture({ unchanged: true, stats: false });
  await runMonthly(f.deps);
  assert.deepEqual(f.git, [['add', 'assets'], ['diff', '--cached', '--quiet']]);
});
test('unchanged dry run cannot stage or commit stats', async () => {
  const f = fixture({ unchanged: true, dryRun: true });
  await runMonthly(f.deps);
  assert.deepEqual(f.git, []);
  assert.deepEqual(f.writes, []);
  assert.deepEqual(mutations(f), []);
  assert.ok(f.logs.length);
});
test('a master push failure prevents PATCH and emits only redacted single-line error', async () => {
  const f = fixture({ privateNames: ['fixture-private'] });
  f.deps.runGit = async args => { if (args[0] === 'push') throw new Error('profile-SENTINEL\noauth-SENTINEL fixture-private'); return { code: args.includes('--quiet') ? 1 : 0 }; };
  await assert.rejects(runMonthly(f.deps), error => {
    assert.doesNotMatch(error.message, /profile-SENTINEL|oauth-SENTINEL|fixture-private|\n/);
    return true;
  });
  assert.deepEqual(mutations(f), []);
});
test('a failed private listing stops before Claude, git or output', async () => {
  const f = fixture();
  const fetch = f.deps.fetch;
  f.deps.fetch = async (url, options) => url.includes('visibility=private') ? { status: 403 } : fetch(url, options);
  await assert.rejects(runMonthly(f.deps), /403/);
  assert.deepEqual(f.claude, []);
  assert.deepEqual(f.git, []);
  assert.deepEqual(mutations(f), []);
});

test('duplicate markers in the draft trigger review rather than publishing malformed README to master', async () => {
  const f = fixture({ draft: { managed: `\nI build.\n${MARKERS[0]}\n` }, stats: false });
  await assert.rejects(runMonthly(f.deps), /Opened .*checks did not pass/);
  assert.ok(f.git.some(args => args[0] === 'switch'));
  assert.ok(!f.git.some(args => args[0] === 'push' && args[2] === 'HEAD:master'));
  assert.deepEqual(mutations(f).map(([, opts]) => opts.method), ['POST']);
});
for (const [field, value] of [['bio', 'I build software.'], ['blog', 'https://zia.saidi.pro/about']]) {
  test(`clean ${field}-only change patches the profile without an empty commit or push`, async () => {
    const f = fixture({ unchanged: true, stats: false, draft: { [field]: value } });
    await runMonthly(f.deps);
    assert.deepEqual(f.git, [['add', 'README.md', 'assets'], ['diff', '--cached', '--quiet']]);
    assert.deepEqual(JSON.parse(mutations(f)[0][1].body), { [field]: value });
    assert.equal(mutations(f).length, 1);
  });
}
for (const [draft, problem] of [
  [{ bio: '' }, 'Bio must be nonempty and at most 160 characters.'],
]) {
  test(`profile review with unchanged README publishes only fresh stats: ${problem}`, async () => {
    const f = fixture({ unchanged: true, draft });
    await assert.rejects(runMonthly(f.deps), { message: `Profile fields need review: ${problem}; nothing was published.` });
    assert.deepEqual(f.git, [['add', 'assets'], ['diff', '--cached', '--quiet'], ['commit', '-m', 'chore: refresh profile stats'], ['push', 'origin', 'HEAD:master']]);
    assert.deepEqual(f.writes, []);
    assert.deepEqual(mutations(f), []);
  });
}
for (const dryRun of [true, false]) {
  test(`private fact-check phrases abort before output or writes (dry run: ${dryRun})`, async () => {
    const f = fixture({ dryRun, privateNames: ['secretproj'], unsupported: ['Unsupported SECRETPROJ claim'] });
    await assert.rejects(runMonthly(f.deps), {
      message: 'A private repository name appeared in fact-check (1 hits); nothing was published.',
    });
    assert.deepEqual(f.git, []);
    assert.deepEqual(f.writes, []);
    assert.deepEqual(mutations(f), []);
    assert.deepEqual(f.logs, []);
  });
}
test('fact-check receives the never-mention list and instruction', async () => {
  const f = fixture({ dryRun: true, privateNames: ['secretproj'] });
  await runMonthly(f.deps);
  assert.deepEqual(JSON.parse(f.claude[1].input).neverMention, ['secretproj']);
  assert.ok(f.claude[1].args.some(arg => arg.includes("Never quote any name on the never-mention list; describe it as 'a name the facts do not support'.")));
});
test('dry run unified diff counts real lines without inventing a trailing empty line', async () => {
  const f = fixture({ dryRun: true });
  await runMonthly(f.deps);
  assert.ok(f.logs[0].includes(`@@ -1,${original.split('\n').length - 1} +1,${joinReadme({ ...parts, managed: proposal.managed }).split('\n').length - 1} @@`));
});

test('credentials in generated fields abort before any output or publishing', async () => {
  const f = fixture({ draft: { managed: 'oauth-SENTINEL', bio: 'profile-SENTINEL' } });
  await assert.rejects(runMonthly(f.deps), /credential.*nothing was published/i);
  assert.deepEqual(f.git, []);
  assert.deepEqual(f.writes, []);
  assert.deepEqual(mutations(f), []);
  assert.deepEqual(f.logs, []);
});

test('public hosts and discovered project slugs leave the guard and never-mention list', async () => {
  const f = fixture({ dryRun: true, privateNames: ['AWNA.AI', 'casestudy', 'secretproj'],
    draft: { managed: 'Casestudy [website](https://awna.ai)', summary: 'Casestudy on awna.ai' } });
  const fetch = f.deps.fetch;
  f.deps.fetch = async (url, options) => url === 'https://zia.saidi.pro/projects'
    ? { status: 200, text: async () => '<a href="/projects/Casestudy">Case study</a>' } : fetch(url, options);
  await runMonthly(f.deps);
  const payload = JSON.parse(f.claude[0].input);
  assert.deepEqual(payload.neverMention, ['secretproj']);
  assert.match(f.logs.join(' '), /Casestudy/);
  assert.match(f.logs.join(' '), /https:\/\/awna.ai/);
  f.claude.length = 0;
  const runClaude = f.deps.runClaude;
  f.deps.runClaude = async call => {
    const result = await runClaude(call);
    if (f.claude.length === 1) {
      const outer = JSON.parse(result.stdout);
      outer.result = JSON.stringify({ ...JSON.parse(outer.result), managed: 'secretproj' });
      return { ...result, stdout: JSON.stringify(outer) };
    }
    return result;
  };
  await assert.rejects(runMonthly(f.deps), /private repository name appeared/);
});

test('private names outside published managed regions cannot offset new managed hits', async () => {
  const f = fixture({ privateNames: ['secretproj'], draft: { managed: 'New Secretproj work.' } });
  f.deps.readFile = async () => joinReadme({ ...parts, before: 'Secretproj hero\n' });
  await assert.rejects(runMonthly(f.deps), /private repository name appeared in managed \(1 hits\)/);
  assert.deepEqual(f.git, []);
  assert.deepEqual(f.claude.length, 1);
});

test('empty private list fails closed before drafting or publishing', async () => {
  const f = fixture({ privateNames: [] });
  await assert.rejects(runMonthly(f.deps), { message: 'Could not list any private repositories; refusing to publish without the private-name guard.' });
  assert.deepEqual(f.claude, []);
  assert.deepEqual(f.git, []);
  assert.deepEqual(f.writes, []);
  assert.deepEqual(f.logs, []);
  assert.deepEqual(mutations(f), []);
});

test('off-allowlist bare URL in a new managed block requires review', async () => {
  const f = fixture({ dryRun: true, draft: { managed: 'Work at https://evil.example/work.' } });
  await runMonthly(f.deps);
  assert.match(f.logs.join('\n'), /A new link must use HTTPS on an allowlisted host/);
  assert.deepEqual(f.git, []);
});

for (const managed of ['', '   \n', 'abc']) {
  test(`empty or excessively shortened draft requires review: ${JSON.stringify(managed)}`, async () => {
    const f = fixture({ dryRun: true, draft: { managed } });
    await runMonthly(f.deps);
    assert.match(f.logs.join('\n'), managed.trim() ? /Draft managed block is under 40%/ : /Draft managed block is empty\./);
    assert.deepEqual(f.git, []);
  });
}

for (const dryRun of [true, false]) {
  test(`guard-approved content is not private-redacted in ${dryRun ? 'dry-run output' : 'PR body'}`, async () => {
    const f = fixture({ dryRun, privateNames: ['build'], draft: { company: 'Needs review' },
      unsupported: ['profile-SENTINEL oauth-SENTINEL'] });
    if (dryRun) await runMonthly(f.deps);
    else await assert.rejects(runMonthly(f.deps), /Opened .*for review/);
    const output = dryRun ? f.logs.join('\n') : JSON.parse(mutations(f)[0][1].body).body;
    assert.match(output, /I build software\./);
    assert.match(output, /"bio": "I build software\."/);
    if (dryRun) assert.match(output, /-I build\./);
    assert.doesNotMatch(output, /profile-SENTINEL|oauth-SENTINEL/);
  });
}
test('error private redaction uses Unicode letter/digit boundaries', async () => {
  const f = fixture({ privateNames: ['secretproj'] });
  f.deps.runGit = async () => { throw new Error('Secretproj-based secretproj_x (SECRETPROJ) secretprojs ésecretproj secretproj٣ profile-SENTINEL'); };
  await assert.rejects(runMonthly(f.deps), {
    message: '[redacted]-based [redacted]_x ([redacted]) secretprojs ésecretproj secretproj٣ [redacted]',
  });
});

test('an already-empty managed block still needs review on an otherwise unchanged run', async () => {
  const f = fixture({ unchanged: true, draft: { managed: '\n' } });
  f.deps.readFile = async () => joinReadme({ ...parts, managed: '\n' });
  await assert.rejects(runMonthly(f.deps), /Profile fields need review: Draft managed block is empty\./);
  assert.deepEqual(f.writes, []);
  assert.deepEqual(mutations(f), []);
});

for (const company of ['fixture-private', 42, null]) {
  test(`extra company is ignored for publishing and unchanged detection: ${JSON.stringify(company)}`, async () => {
    const f = fixture({ draft: { company, blog: 'https://zia.saidi.pro/about' } });
    await runMonthly(f.deps);
    assert.deepEqual(JSON.parse(mutations(f)[0][1].body), { bio: proposal.bio, blog: 'https://zia.saidi.pro/about' });
    assert.deepEqual(JSON.parse(f.claude[0].input).current, { bio: current.bio, blog: current.blog });
    const unchanged = fixture({ unchanged: true, stats: false, draft: { company } });
    await runMonthly(unchanged.deps);
    assert.equal(unchanged.claude.length, 1);
    assert.deepEqual(mutations(unchanged), []);
  });
}

for (const unsupported of [[], ['A fixture claim']]) {
  test(`fact check retries once and uses the successful result: ${JSON.stringify(unsupported)}`, async () => {
    const f = fixture({ dryRun: true, unsupported });
    const runClaude = f.deps.runClaude;
    f.deps.runClaude = async call => {
      const outcome = await runClaude(call);
      return f.claude.length === 2 ? { code: 0, stdout: JSON.stringify({ result: 'not JSON' }) } : outcome;
    };
    await runMonthly(f.deps);
    assert.equal(f.claude.length, 3);
    const output = f.logs.join('\n');
    assert.doesNotMatch(output, /Fact check did not return/);
    assert.equal(output.includes('Fact check unsupported: A fixture claim'), unsupported.length > 0);
    assert.deepEqual(f.git, []);
    assert.deepEqual(f.writes, []);
    assert.deepEqual(mutations(f), []);
  });
}
for (const [outcome, kind] of [
  [{ code: 0, stdout: JSON.stringify({ result: 'MODEL-SENTINEL', stop_reason: 'refusal' }) }, 'refusal'],
  [{ code: 0, stdout: JSON.stringify({ result: 'MODEL-SENTINEL' }) }, 'invalid-json'],
  [{ code: 0, stdout: 'null' }, 'unknown'],
]) {
  test(`two fact-check failures report only the final kind: ${kind}`, async () => {
    const f = fixture({ dryRun: true });
    const runClaude = f.deps.runClaude;
    f.deps.runClaude = async call => {
      const original = await runClaude(call);
      if (f.claude.length === 2) return { code: 0, stdout: JSON.stringify({ result: 'FIRST-SENTINEL' }) };
      return f.claude.length === 3 ? outcome : original;
    };
    await runMonthly(f.deps);
    assert.equal(f.claude.length, 3);
    assert.deepEqual(f.logs[1].split('\n').filter(line => line.startsWith('- ')), [
      `- Fact check did not return a valid result (${kind}).`,
    ]);
    assert.doesNotMatch(f.logs.join('\n'), /MODEL-SENTINEL|FIRST-SENTINEL|declined|Cannot read/);
    assert.deepEqual(f.git, []);
    assert.deepEqual(f.writes, []);
    assert.deepEqual(mutations(f), []);
  });
}
