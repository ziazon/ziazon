import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { fetchSiteFacts } from './site-facts.mjs';
import { githubRequest, listPublicRepos, listPrivateRepoNames, countPublicSkills, renderProjects } from './repos.mjs';
import { splitReadme, joinReadme } from './readme.mjs';
import { draftProfile, factCheck } from './claude.mjs';
import { ALLOWED_HOSTS, checkOutsideUnchanged, checkNumbers, checkLinks, extractUrls, checkBio, findPrivateNames } from './guards.mjs';

function runGit(args) {
  return new Promise((resolve, reject) => {
    execFile('git', args, (error, stdout) => {
      if (error && typeof error.code !== 'number') reject(new Error('Unable to run git.'));
      else resolve({ code: error?.code ?? 0, stdout });
    });
  });
}

function readmeDiff(oldText, newText) {
  if (oldText === newText) return 'README.md is unchanged.';
  const oldLines = oldText.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const newLines = newText.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const format = (lines, prefix) => lines.map(line => `${prefix}${line.endsWith('\n') ? line : `${line}\n\\ No newline at end of file\n`}`).join('');
  return `--- a/README.md\n+++ b/README.md\n@@ -1,${oldLines.length} +1,${newLines.length} @@\n`
    + format(oldLines, '-') + format(newLines, '+');
}

function markerBlock(text) {
  if (!text) return '\n';
  return `${text.startsWith('\n') ? '' : '\n'}${text}${text.endsWith('\n') ? '' : '\n'}`;
}

export async function runMonthly(deps) {
  const { fetch = globalThis.fetch, token, oauthToken, repository, runId, dryRun = false,
    now = () => new Date(), log = console.log } = deps;
  const read = deps.readFile ?? readFile;
  const write = deps.writeFile ?? writeFile;
  const gitRunner = deps.runGit ?? runGit;
  const api = { fetch, token };
  let privateNames = [];
  const redactTokens = value => {
    let text = String(value);
    for (const secret of [token, oauthToken]) if (secret) text = text.replaceAll(secret, '[redacted]');
    return text;
  };
  const redactError = value => {
    let text = redactTokens(value);
    for (const name of privateNames) {
      if (name.length < 3) continue;
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      text = text.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'giu'), '[redacted]');
    }
    return text;
  };
  async function git(args, diff = false) {
    const result = await gitRunner(args);
    if (result.code !== 0 && !(diff && result.code === 1)) throw new Error(`git ${args[0]} failed with exit code ${result.code}.`);
    return result;
  }
  async function commitStats() {
    await git(['add', 'assets']);
    const result = await git(['diff', '--cached', '--quiet'], true);
    if (result.code === 0) return;
    await git(['commit', '-m', 'chore: refresh profile stats']);
    await git(['push', 'origin', 'HEAD:master']);
  }
  try {
    const original = await read('README.md', 'utf8');
    const oldParts = splitReadme(original);
    const user = await (await githubRequest(api, '/user')).json();
    const current = Object.fromEntries(['bio', 'blog', 'company'].map(key => [key, user[key] ?? '']));
    const date = now();
    const month = date.toISOString().slice(0, 7);
    const { pages, projectSlugs } = await fetchSiteFacts({ fetch });
    const repos = await listPublicRepos({ ...api, owners: ['ziazon', 'awna-ai'], now: date });
    const skillCount = await countPublicSkills(api);
    privateNames = await listPrivateRepoNames(api);
    if (!privateNames.length) throw new Error('Could not list any private repositories; refusing to publish without the private-name guard.');
    const publicNames = new Set([...ALLOWED_HOSTS, ...projectSlugs.map(slug => slug.toLowerCase())]);
    privateNames = privateNames.filter(name => !publicNames.has(name.toLowerCase()));
    const projects = renderProjects(repos);
    const draft = await draftProfile({ managed: oldParts.managed, current, pages, repos, skillCount,
      neverMention: privateNames, oauthToken, runClaude: deps.runClaude });
    for (const key of ['managed', 'bio', 'blog', 'company', 'summary']) {
      if (typeof draft[key] !== 'string') throw new Error(`Claude draft field ${key} must be a string.`);
    }
    if ([token, oauthToken].some(secret => secret && Object.values(draft).some(value => typeof value === 'string' && value.includes(secret)))) {
      throw new Error('A credential appeared in the draft; nothing was published.');
    }
    const newParts = { ...oldParts, managed: markerBlock(draft.managed), projects: markerBlock(projects) };
    const updated = joinReadme(newParts);
    const published = [oldParts.managed, oldParts.projects, current.bio, current.blog, current.company];
    const hits = findPrivateNames({ managed: newParts.managed, projects: newParts.projects,
      bio: draft.bio, blog: draft.blog, company: draft.company }, published, privateNames);
    const summaryHits = findPrivateNames({ summary: draft.summary }, [], privateNames);
    if (hits.count || summaryHits.count) {
      throw new Error(`A private repository name appeared in ${[...hits.sections, ...summaryHits.sections].join(', ')} (${hits.count + summaryHits.count} hits); nothing was published.`);
    }
    const changedFields = Object.fromEntries(['bio', 'blog'].filter(key => draft[key] !== current[key]).map(key => [key, draft[key]]));
    const managedProblems = [];
    if (!draft.managed.trim()) managedProblems.push('Draft managed block is empty.');
    else if (draft.managed.length < oldParts.managed.length * 0.4) managedProblems.push('Draft managed block is under 40% of the old managed block length.');
    const unchanged = updated === original && !Object.keys(changedFields).length && draft.company === current.company;
    if (unchanged && !dryRun && !managedProblems.length) {
      await commitStats();
      return;
    }
    const facts = { pages, repos, skillCount };
    const corpus = [...pages.map(page => page.text), ...repos.map(repo => repo.description), String(skillCount)].join('\n');
    const problems = [...managedProblems, ...checkNumbers(newParts.managed, draft.bio, corpus),
      ...await checkLinks(extractUrls(updated), extractUrls(original), { fetch }), ...checkBio(draft, current)];
    try {
      problems.push(...checkOutsideUnchanged(oldParts, splitReadme(updated)));
    } catch {
      problems.push('Draft README markers are missing, duplicated or out of order.');
    }
    if (!unchanged) {
      let checked;
      try {
        checked = await factCheck({ facts, managed: newParts.managed, bio: draft.bio, neverMention: privateNames, oauthToken, runClaude: deps.runClaude });
      } catch {
        problems.push('Fact check did not return a valid result.');
      }
      if (checked) {
        if (!Array.isArray(checked.unsupported) || checked.unsupported.some(phrase => typeof phrase !== 'string')) {
          problems.push('Fact check did not return a valid unsupported list.');
        } else {
          const hits = findPrivateNames({ 'fact-check': checked.unsupported.join('\n') }, [], privateNames);
          if (hits.count) throw new Error(`A private repository name appeared in fact-check (${hits.count} hits); nothing was published.`);
          problems.push(...checked.unsupported.map(phrase => `Fact check unsupported: ${phrase}`));
        }
      }
    }
    const summary = redactTokens(draft.summary).replace(/[\r\n]+/g, ' ');
    const proposed = JSON.stringify({ bio: draft.bio, blog: draft.blog, company: draft.company }, null, 2);
    const review = redactTokens([summary, '', ...problems.map(problem => `- ${problem}`), '', 'Proposed profile:', proposed].join('\n'));
    if (dryRun) {
      log(redactTokens(readmeDiff(original, updated)));
      log(review);
      return;
    }
    if (!problems.length) {
      await write('README.md', updated, 'utf8');
      await git(['add', 'README.md', 'assets']);
      const staged = await git(['diff', '--cached', '--quiet'], true);
      if (staged.code === 1) {
        await git(['commit', '-m', `chore: monthly profile update (${month})`, '-m', summary]);
        await git(['push', 'origin', 'HEAD:master']);
      }
      if (Object.keys(changedFields).length) await githubRequest(api, '/user', { method: 'PATCH', body: JSON.stringify(changedFields) });
      return;
    }
    if (updated === original) {
      await commitStats();
      throw new Error(`Profile fields need review: ${problems.join('; ')}; nothing was published.`);
    }
    await commitStats();
    const branch = `profile-update/${month}-${runId}`;
    await git(['switch', '-c', branch]);
    await write('README.md', updated, 'utf8');
    await git(['add', 'README.md']);
    await git(['commit', '-m', `chore: monthly profile update (${month})`, '-m', summary]);
    await git(['push', 'origin', `HEAD:${branch}`]);
    const pr = await (await githubRequest(api, `/repos/${repository}/pulls`, { method: 'POST', body: JSON.stringify({
      title: `Monthly profile update ${month} needs review`, head: branch, base: 'master', body: review,
    }) })).json();
    throw new Error(`Opened ${pr.html_url} for review: ${problems.length} checks did not pass.`);
  } catch (error) {
    throw new Error(redactError(error instanceof Error ? error.message : String(error)).replace(/[\r\n]+/g, ' '));
  }
}
