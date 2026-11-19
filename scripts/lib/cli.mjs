import { runMonthly } from './monthly.mjs';

const REQUIRED = ['CLAUDE_CODE_OAUTH_TOKEN', 'PROFILE_TOKEN', 'GITHUB_REPOSITORY', 'GITHUB_RUN_ID'];

export async function main({ env = process.env, run = runMonthly, error = console.error } = {}) {
  const missing = REQUIRED.filter(name => !env[name]);
  if (missing.length) {
    error(`Missing required environment: ${missing.join(', ')}.`);
    return 1;
  }
  try {
    await run({ oauthToken: env.CLAUDE_CODE_OAUTH_TOKEN, token: env.PROFILE_TOKEN,
      repository: env.GITHUB_REPOSITORY, runId: env.GITHUB_RUN_ID, dryRun: env.DRY_RUN === 'true' });
    return 0;
  } catch (failure) {
    let message = failure instanceof Error ? failure.message : String(failure);
    for (const key of ['CLAUDE_CODE_OAUTH_TOKEN', 'PROFILE_TOKEN', 'GITHUB_TOKEN']) {
      if (env[key]) message = message.replaceAll(env[key], '[redacted]');
    }
    error(message.replace(/[\r\n]+/g, ' '));
    return 1;
  }
}
