export const ALLOWED_HOSTS = new Set(['zia.saidi.pro', 'awna.ai', 'github.com', 'raw.githubusercontent.com', 'www.linkedin.com', 'www.patreon.com', 'fantastical.app']);

function allowedUrl(raw) {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && ALLOWED_HOSTS.has(url.hostname) && !url.username && !url.password && !url.port;
  } catch {
    return false;
  }
}

export function checkOutsideUnchanged(oldParts, newParts) {
  return ['before', 'between', 'after'].filter(key => oldParts[key] !== newParts[key])
    .map(key => `README ${key} changed outside the managed blocks.`);
}

export function checkNumbers(managedMarkdown, bio, corpusText) {
  const visible = `${managedMarkdown}\n${bio}`.replace(/<!--[\s\S]*?-->|<\/?[A-Za-z][^>]*>/g, ' ')
    .replace(/\]\([^)]*\)/g, ']').replace(/https?:\/\/[^\s<>]+/g, ' ');
  return [...new Set(visible.match(/\p{Nd}+(?:[.,]\p{Nd}+)*/gu) ?? [])]
    .filter(number => !new RegExp(`(?<![\\p{Nd}.,])${number.replace(/\./g, '\\$&')}(?!\\p{Nd}|[.,]\\p{Nd})`, 'u').test(corpusText))
    .map(number => `Number ${number} is not written in the facts.`);
}

export function extractUrls(text) {
  const urls = [];
  const inlineText = text.replace(/^ {0,3}\[[^\]\n]+\]:[ \t]*(?:\r?\n[ \t]*)?(?:<([^>\n]*)>|([^\s]+))[^\n]*$/gm,
    (match, angled, bare) => {
      urls.push(angled ?? bare);
      return ' ';
    });
  const remaining = inlineText.replace(/\]\(\s*<?([^\s)>]+)>?(?:\s+(?:"[^"\n]*"|'[^'\n]*'|\([^\n]*?\)))?\s*\)|\b(href|src|srcset)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi,
    (match, destination, attribute, doubleQuoted, singleQuoted, unquoted) => {
      if (destination) urls.push(destination);
      else {
        const value = doubleQuoted ?? singleQuoted ?? unquoted;
        if (attribute.toLowerCase() === 'srcset') urls.push(...value.split(',').map(part => part.trim().split(/\s+/)[0]).filter(Boolean));
        else urls.push(value);
      }
      return ' ';
    });
  for (const [raw] of remaining.matchAll(/(?:https?:\/\/|www\.)[^\s<>"']+/gi)) {
    const url = raw.replace(/[.,;:!?)\]]+$/g, '');
    urls.push(/^www\./i.test(url) ? `https://${url}` : url);
  }
  return [...new Set(urls.map(url => url.replaceAll('&amp;', '&')).map(url => url.startsWith('//') ? `https:${url}` : url))];
}

export async function checkLinks(newUrls, publishedUrls, { fetch }) {
  const published = new Set(publishedUrls);
  const problems = [];
  for (const url of new Set(newUrls)) {
    if (published.has(url)) continue;
    if (!allowedUrl(url)) {
      problems.push('A new link must use HTTPS on an allowlisted host.');
      continue;
    }
    try {
      const response = await fetch(url, { method: 'GET', redirect: 'follow' });
      if (response.status !== 200) problems.push(`A new link returned status ${response.status}.`);
      else if (response.url && !allowedUrl(response.url)) problems.push('A new link redirected outside the allowlist.');
    } catch {
      problems.push('A new link could not be fetched.');
    }
  }
  return problems;
}

export function checkBio({ bio, blog }) {
  const problems = [];
  if (typeof bio !== 'string' || !bio.trim() || [...bio].length > 160) problems.push('Bio must be nonempty and at most 160 characters.');
  if (!allowedUrl(blog)) problems.push('Blog must use HTTPS on an allowlisted host.');
  return problems;
}

export function findPrivateNames(texts, publishedTexts, privateNames) {
  let count = 0;
  const sections = new Set();
  for (const name of new Set(privateNames.map(name => name.toLowerCase()))) {
    if (name.length < 3) continue;
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const matches = text => [...String(text).matchAll(new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'giu'))].length;
    const oldCount = Object.values(publishedTexts).reduce((sum, text) => sum + matches(text), 0);
    const entries = Object.entries(texts).map(([label, text]) => [label, matches(text)]);
    const added = entries.reduce((sum, [, hits]) => sum + hits, 0) - oldCount;
    if (added > 0) {
      count += added;
      for (const [label, hits] of entries) if (hits) sections.add(label);
    }
  }
  return { count, sections: [...sections] };
}
