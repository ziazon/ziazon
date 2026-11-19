import assert from 'node:assert/strict';
import { test } from 'node:test';
import { htmlToText, fetchSiteFacts } from './site-facts.mjs';

test('HTML conversion removes executable blocks and decodes named and numeric entities', () => {
  assert.equal(htmlToText('<script>secret</script><STYLE>hidden</STYLE><noscript>hidden</noscript><p>A &amp; &lt; &gt; &quot; &#39; &nbsp; &#65; &#x1F600;</p>\n<b>B</b>'), 'A & < > " \' A 😀 B');
});
test('fetches fixed pages and deduplicated sorted project pages, following redirects', async () => {
  const calls = [];
  const { pages, projectSlugs } = await fetchSiteFacts({ fetch: async (url, options) => {
    calls.push([url, options.redirect]);
    return { status: 200, text: async () => url.endsWith('/projects') ? '<a href="/projects/z">Z</a><a href="/projects/a">A</a><a href="/projects/z">Z</a>' : '<p>Facts</p>' };
  } });
  assert.deepEqual(calls, ['', 'about', 'projects', 'process', 'request-for-proposal', 'projects/a', 'projects/z'].map(p => [`https://zia.saidi.pro/${p}`, 'follow']));
  assert.deepEqual(projectSlugs, ['a', 'z']);
  assert.equal(pages.length, 7);
  assert.deepEqual(pages[0], { url: 'https://zia.saidi.pro/', text: 'Facts' });
});
test('records final URLs and scans the projects page even when it redirects', async () => {
  const redirects = new Map([
    ['projects', 'https://awna.ai/work/'],
    ['process', 'https://awna.ai/how-we-work/'],
    ['request-for-proposal', 'https://awna.ai/consulting/'],
  ]);
  const { pages } = await fetchSiteFacts({ fetch: async url => {
    const path = new URL(url).pathname.slice(1);
    return { status: 200, url: redirects.get(path) ?? '', text: async () => path === 'projects' ? '<a href="/projects/example">Example</a>' : '<p>Facts</p>' };
  } });
  assert.deepEqual(pages.map(page => page.url), [
    'https://zia.saidi.pro/', 'https://zia.saidi.pro/about', 'https://awna.ai/work/',
    'https://awna.ai/how-we-work/', 'https://awna.ai/consulting/', 'https://zia.saidi.pro/projects/example',
  ]);
});
for (const url of ['https://example.com/', 'https://awna.ai.example.com/', 'http://awna.ai/', 'http://zia.saidi.pro/']) {
  test(`rejects an unsafe final page URL: ${url}`, async () => {
    await assert.rejects(fetchSiteFacts({ fetch: async () => ({ status: 200, url, text: async () => 'Facts' }) }), /final URL/i);
  });
}
test('a non-200 site page fails closed', async () => {
  await assert.rejects(fetchSiteFacts({ fetch: async () => ({ status: 503 }) }), /503/);
});
