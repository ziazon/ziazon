import { mkdir, writeFile } from 'node:fs/promises';

import {
  THEMES,
  assertVerifiableStats,
  renderActivityCard,
  renderStatsCard,
} from './lib/stats.mjs';

const assetsDir = new URL('../assets/', import.meta.url);

const token = process.env.GITHUB_TOKEN;

if (!token) {
  console.error('GITHUB_TOKEN is unset — cannot generate stats.');
  process.exit(1);
}

const login = process.env.GITHUB_LOGIN || 'ziazon';
const commonHeaders = {
  Authorization: `bearer ${token}`,
  'User-Agent': 'ziazon-profile-stats',
};

async function fetchStats() {
  const query = `query($login: String!) {
    user(login: $login) {
      createdAt
      contributionsCollection {
        totalCommitContributions
        restrictedContributionsCount
        contributionCalendar {
          totalContributions
          weeks { contributionDays { date contributionCount } }
        }
      }
    }
  }`;
  const graphqlResponse = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      ...commonHeaders,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables: { login } }),
  });

  const graphqlBody = await graphqlResponse.json();
  if (Array.isArray(graphqlBody.errors) && graphqlBody.errors.length > 0) {
    const messages = graphqlBody.errors.map(({ message }) => message).join('; ');
    throw new Error(`GitHub GraphQL errors: ${messages}`);
  }
  if (!graphqlResponse.ok) {
    throw new Error(`GitHub GraphQL request failed with status ${graphqlResponse.status}.`);
  }
  if (!graphqlBody.data?.user) {
    throw new Error(`GitHub user ${login} was not found.`);
  }

  const restResponse = await fetch(
    `https://api.github.com/search/issues?q=author:${encodeURIComponent(login)}+type:pr&per_page=1`,
    {
      headers: {
        ...commonHeaders,
        Accept: 'application/vnd.github+json',
      },
    },
  );

  if (!restResponse.ok) {
    throw new Error(`GitHub pull request search failed with status ${restResponse.status}.`);
  }

  const restBody = await restResponse.json();
  const user = graphqlBody.data.user;
  const collection = user.contributionsCollection;

  return {
    totalContributions: collection.contributionCalendar.totalContributions,
    publicCommits: collection.totalCommitContributions,
    restrictedContributions: collection.restrictedContributionsCount,
    pullRequestsAllTime: restBody.total_count,
    githubSinceYear: user.createdAt.slice(0, 4),
    contributionDays: collection.contributionCalendar.weeks.flatMap(
      ({ contributionDays }) => contributionDays,
    ),
  };
}

async function main() {
  const raw = await fetchStats();
  assertVerifiableStats(raw, {
    allowZeroPrivate: process.env.ALLOW_ZERO_PRIVATE === '1',
  });

  const files = [
    ['stats-light.svg', renderStatsCard(raw, THEMES.light)],
    ['stats-dark.svg', renderStatsCard(raw, THEMES.dark)],
    ['activity-light.svg', renderActivityCard(raw, THEMES.light)],
    ['activity-dark.svg', renderActivityCard(raw, THEMES.dark)],
  ];

  await mkdir(assetsDir, { recursive: true });
  for (const [name, svg] of files) {
    await writeFile(new URL(name, assetsDir), `${svg}\n`, 'utf8');
    console.log(`wrote assets/${name}`);
  }
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
