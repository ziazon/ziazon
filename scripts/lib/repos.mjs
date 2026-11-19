export async function githubRequest({ fetch, token }, path, options = {}) {
  const url = new URL(path, 'https://api.github.com');
  if (url.origin !== 'https://api.github.com') throw new Error('GitHub pagination left the API host.');
  const response = await fetch(url.href, {
    ...options,
    redirect: 'error',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', 'User-Agent': 'ziazon-profile-monthly' },
  });
  const expected = options.method === 'POST' ? 201 : 200;
  if (response.status !== expected) throw new Error(`GitHub request failed with status ${response.status}.`);
  return response;
}

async function listPages(deps, path) {
  const entries = [];
  const seen = new Set();
  while (path) {
    if (seen.has(path)) throw new Error('GitHub pagination repeated a page.');
    seen.add(path);
    const response = await githubRequest(deps, path);
    const body = await response.json();
    if (!Array.isArray(body)) throw new Error('GitHub listing was not an array.');
    entries.push(...body);
    path = response.headers.get('link')?.match(/<([^>]+)>;\s*rel="next"/)?.[1];
  }
  return entries;
}

export async function listPublicRepos({ fetch, token, owners = ['ziazon', 'awna-ai'], now }) {
  const repos = [];
  const cutoff = new Date(now).getTime() - 365 * 24 * 60 * 60 * 1000;
  for (const owner of owners) {
    const path = owner === 'ziazon' ? `/users/${owner}/repos?type=owner&per_page=100` : `/orgs/${owner}/repos?type=public&per_page=100`;
    const entries = await listPages({ fetch, token }, path);
    repos.push(...entries.filter(repo => repo.private === false && repo.visibility === 'public'
      && repo.fork === false && repo.archived === false && Date.parse(repo.pushed_at) >= cutoff
      && Date.parse(repo.pushed_at) <= new Date(now).getTime()
      && repo.name !== (repo.owner?.login ?? owner) && repo.name !== '.github'));
  }
  return repos.map(repo => ({ fullName: repo.full_name, url: repo.html_url, description: typeof repo.description === 'string' ? repo.description : '', pushedAt: repo.pushed_at }))
    .sort((a, b) => Date.parse(b.pushedAt) - Date.parse(a.pushedAt));
}

export async function listPrivateRepoNames(deps) {
  const names = [];
  for (const [path, ownerPath] of [
    ['/user/repos?affiliation=owner&visibility=private&per_page=100', '/user'],
    ['/orgs/awna-ai/repos?type=private&per_page=100', '/orgs/awna-ai'],
  ]) {
    const repos = await listPages(deps, path);
    const owner = await (await githubRequest(deps, ownerPath)).json();
    const expected = owner?.owned_private_repos ?? (ownerPath === '/user' ? undefined : owner?.total_private_repos);
    if (!Number.isInteger(expected) || expected < 0 || expected !== repos.length) {
      throw new Error('Private repository listing is incomplete; refusing to publish.');
    }
    names.push(...repos.map(repo => repo.name));
  }
  return [...new Set(names)];
}

export async function countPublicSkills(deps) {
  const response = await githubRequest(deps, '/repos/ziazon/zizi-skills/contents/skills');
  const entries = await response.json();
  if (!Array.isArray(entries)) throw new Error('GitHub skills listing was not an array.');
  return entries.filter(entry => entry.type === 'dir').length;
}

export function renderProjects(repos) {
  if (!repos.length) return '';
  const escape = text => text.replaceAll('[', '\\[').replaceAll(']', '\\]').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const bullets = repos.map(repo => `- **[${repo.fullName.split('/').at(-1)}](${repo.url})**${repo.description ? ` — ${escape(repo.description)}` : ''}`);
  return `## Open-source projects\n\n${bullets.join('\n')}\n\n`;
}
