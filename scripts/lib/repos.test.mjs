import assert from 'node:assert/strict';
import { test } from 'node:test';
import { listPublicRepos, listPrivateRepoNames, countPublicSkills, renderProjects } from './repos.mjs';

const repo = (name, extra = {}) => ({ name, owner: { login: 'ziazon' }, full_name: `ziazon/${name}`, html_url: `https://github.com/ziazon/${name}`, description: null, private: false, visibility: 'public', fork: false, archived: false, pushed_at: '2026-11-01T00:00:00Z', ...extra });
function fakePages(pages) {
  const calls = [];
  const fetch = async (url, options) => {
    calls.push([url, options]);
    const page = pages.shift();
    assert.ok(page, 'unexpected request');
    return { status: 200, headers: new Headers(page.next ? { Link: `<${page.next}>; rel="next"` } : {}), json: async () => page.data, ...page.response };
  };
  return { fetch, calls };
}
test('public repos paginate both owners, filter every excluded type, and sort newest first', async () => {
  const next = 'https://api.github.com/users/ziazon/repos?page=2';
  const { fetch, calls } = fakePages([
    { next, data: [repo('good'), repo('private', { private: true }), repo('internal', { visibility: 'internal' }), repo('fork', { fork: true }), repo('archived', { archived: true }), repo('stale', { pushed_at: '2025-01-01' }), repo('.github'), repo('ziazon')] },
    { data: [repo('older', { pushed_at: '2026-01-01', description: 'old' })] },
    { data: [repo('awna-ai', { owner: { login: 'awna-ai' } }), repo('new', { full_name: 'awna-ai/new', pushed_at: '2026-11-02' })] },
  ]);
  const result = await listPublicRepos({ fetch, token: 'fake', owners: ['ziazon', 'awna-ai'], now: new Date('2026-11-19') });
  assert.deepEqual(result.map(r => r.fullName), ['awna-ai/new', 'ziazon/good', 'ziazon/older']);
  assert.deepEqual(result[1], { fullName: 'ziazon/good', url: 'https://github.com/ziazon/good', description: '', pushedAt: '2026-11-01T00:00:00Z' });
  assert.equal(calls[0][0], 'https://api.github.com/users/ziazon/repos?type=owner&per_page=100');
  assert.equal(calls[1][0], next);
  assert.equal(calls[2][0], 'https://api.github.com/orgs/awna-ai/repos?type=public&per_page=100');
});
test('private listing paginates both endpoints and returns names only', async () => {
  const { fetch, calls } = fakePages([{ next: 'https://api.github.com/user/repos?page=2', data: [{ name: 'fixture-a' }] }, { data: [{ name: 'fixture-b' }] }, { data: { owned_private_repos: 2 } }, { next: 'https://api.github.com/orgs/awna-ai/repos?page=2', data: [] }, { data: [{ name: 'fixture-c' }] }, { data: { owned_private_repos: 1 } }]);
  assert.deepEqual(await listPrivateRepoNames({ fetch, token: 'fake' }), ['fixture-a', 'fixture-b', 'fixture-c']);
  assert.equal(calls[0][0], 'https://api.github.com/user/repos?affiliation=owner&visibility=private&per_page=100');
  assert.equal(calls[3][0], 'https://api.github.com/orgs/awna-ai/repos?type=private&per_page=100');
});
for (const [name, fn] of Object.entries({ listPublicRepos, listPrivateRepoNames, countPublicSkills })) {
  test(`${name} rejects non-200 without exposing response bodies`, async () => {
    await assert.rejects(fn({ fetch: async () => ({ status: 403 }), token: 'fake', owners: ['ziazon'], now: new Date() }), /403/);
  });
}
test('skills counts only directories', async () => {
  const { fetch, calls } = fakePages([{ data: [{ type: 'dir' }, { type: 'file' }, { type: 'dir' }] }]);
  assert.equal(await countPublicSkills({ fetch, token: 'fake' }), 2);
  assert.equal(calls[0][0], 'https://api.github.com/repos/ziazon/zizi-skills/contents/skills');
});
test('renders projects with escaped descriptions and no dash for empty descriptions', () => {
  assert.equal(renderProjects([{ fullName: 'ziazon/a', url: 'https://github.com/ziazon/a', description: '[x] <b>' }, { fullName: 'awna-ai/b', url: 'https://github.com/awna-ai/b', description: '' }]), '## Open-source projects\n\n- **[a](https://github.com/ziazon/a)** — \\[x\\] &lt;b&gt;\n- **[b](https://github.com/awna-ai/b)**\n\n');
});
test('empty projects render nothing', () => assert.equal(renderProjects([]), ''));

test('public repos include the 365-day boundary but exclude older and future pushes', async () => {
  const { fetch } = fakePages([{ data: [repo('boundary', { pushed_at: '2025-11-19T00:00:00Z' }), repo('older', { pushed_at: '2025-11-18T23:59:59Z' }), repo('future', { pushed_at: '2026-11-20T00:00:00Z' })] }]);
  const result = await listPublicRepos({ fetch, token: 'fake', owners: ['ziazon'], now: new Date('2026-11-19T00:00:00Z') });
  assert.deepEqual(result.map(repo => repo.fullName), ['ziazon/boundary']);
});

for (const [label, user, org, passes] of [
  ['matching counts', { owned_private_repos: 1 }, { owned_private_repos: 1 }, true],
  ['org fallback', { owned_private_repos: 1 }, { total_private_repos: 1 }, true],
  ['owned count takes precedence', { owned_private_repos: 1 }, { owned_private_repos: 1, total_private_repos: 2 }, true],
  ['partial user list', { owned_private_repos: 2 }, { owned_private_repos: 1 }, false],
  ['partial org list', { owned_private_repos: 1 }, { owned_private_repos: 2 }, false],
  ['missing user count', {}, { owned_private_repos: 1 }, false],
  ['missing org count', { owned_private_repos: 1 }, {}, false],
  ['fallback mismatch', { owned_private_repos: 1 }, { total_private_repos: 2 }, false],
]) {
  test(`private listing completeness: ${label}`, async () => {
    const fetch = async url => ({
      status: 200, headers: new Headers(), json: async () => {
        const path = new URL(url).pathname;
        if (path === '/user') return user;
        if (path === '/orgs/awna-ai') return org;
        return [{ name: path === '/user/repos' ? 'secretproj' : 'casestudy' }];
      },
    });
    if (passes) assert.deepEqual(await listPrivateRepoNames({ fetch, token: 'fake' }), ['secretproj', 'casestudy']);
    else await assert.rejects(listPrivateRepoNames({ fetch, token: 'fake' }), {
      message: 'Private repository listing is incomplete; refusing to publish.',
    });
  });
}
