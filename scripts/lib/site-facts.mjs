const ENTITIES = new Map(Object.entries({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ' }));

export function htmlToText(html) {
  return html.replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|nbsp);/gi, (entity, key) => {
      if (ENTITIES.has(key.toLowerCase())) return ENTITIES.get(key.toLowerCase());
      const code = key[1].toLowerCase() === 'x' ? parseInt(key.slice(2), 16) : Number(key.slice(1));
      return code <= 0x10ffff ? String.fromCodePoint(code) : entity;
    }).replace(/\s+/g, ' ').trim();
}

export async function fetchSiteFacts({ fetch }) {
  async function page(path) {
    const url = `https://zia.saidi.pro/${path}`;
    const response = await fetch(url, { redirect: 'follow' });
    if (response.status !== 200) throw new Error(`Website page failed with status ${response.status}.`);
    const finalUrl = response.url || url;
    const parsed = new URL(finalUrl);
    if (parsed.protocol !== 'https:' || !['zia.saidi.pro', 'awna.ai'].includes(parsed.hostname)) {
      throw new Error('Website page final URL must use HTTPS on zia.saidi.pro or awna.ai.');
    }
    return { url: finalUrl, html: await response.text() };
  }
  const pages = [];
  let projectsPage;
  for (const path of ['', 'about', 'projects', 'process', 'request-for-proposal']) {
    const fetched = await page(path);
    pages.push(fetched);
    if (path === 'projects') projectsPage = fetched;
  }
  const slugs = [...new Set([...projectsPage.html.matchAll(/href="\/projects\/([a-zA-Z0-9_-]+)"/g)].map(match => match[1]))].sort();
  for (const slug of slugs) pages.push(await page(`projects/${slug}`));
  return { pages: pages.map(({ url, html }) => ({ url, text: htmlToText(html) })), projectSlugs: slugs };
}
