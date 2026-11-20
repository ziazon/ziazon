import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkOutsideUnchanged, checkNumbers, extractUrls, checkMovedLinks, checkLinks, checkBio, findPrivateNames } from './guards.mjs';

test('outside guard accepts identical protected regions and flags each changed region', () => {
  const parts = { before: 'a', between: 'b', after: 'c' };
  assert.deepEqual(checkOutsideUnchanged(parts, parts), []);
  for (const field of Object.keys(parts)) assert.equal(checkOutsideUnchanged(parts, { ...parts, [field]: 'changed' }).length, 1);
});
test('numbers require exact written digits with non-digit boundaries, including bio', () => {
  assert.deepEqual(checkNumbers('45,000 products and 3.5 years', '25+ years', '45,000 products; 3.5 years; 25 years'), []);
  assert.equal(checkNumbers('30 years', '', 'Thirty years').length, 1);
  assert.equal(checkNumbers('', '30 years', '130 years').length, 1);
});
test('number guard ignores attributes, markdown destinations and bare URLs', () => {
  assert.deepEqual(checkNumbers('<a href="https://a/123" width="400">Work</a> [Work](https://a/456) https://a/789', '', ''), []);
  assert.equal(checkNumbers('<b>99</b>', '', '').length, 1);
});
test('extracts markdown, href, src and all srcset URLs without density descriptors', () => {
  assert.deepEqual(extractUrls('[a](https://github.com/a) <a href=\'https://awna.ai\'>A</a><img src="https://zia.saidi.pro/a" srcset="https://awna.ai/a 1x, https://awna.ai/b 2x">'), ['https://github.com/a', 'https://awna.ai', 'https://zia.saidi.pro/a', 'https://awna.ai/a', 'https://awna.ai/b']);
});
test('new links must use https and an allowed host; published LinkedIn links are exempt', async () => {
  const calls = [];
  const fetch = async (url, options) => { calls.push([url, options]); return { status: 200 }; };
  const published = ['https://www.linkedin.com/in/ziasaidi/'];
  assert.deepEqual(await checkLinks([...published, 'https://awna.ai/a'], published, { fetch }), []);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1].redirect, 'follow');
  assert.equal((await checkLinks(['https://evil.example/a', 'http://awna.ai', 'https://awna.ai.evil.example', 'javascript:alert(1)'], [], { fetch })).length, 4);
  assert.equal(calls.length, 1);
});
test('link errors and non-200 responses become problems', async () => {
  assert.equal((await checkLinks(['https://awna.ai/a'], [], { fetch: async () => ({ status: 404 }) })).length, 1);
  assert.equal((await checkLinks(['https://awna.ai/a'], [], { fetch: async () => { throw new Error('offline'); } })).length, 1);
});
test('bio validates length, nonempty content and blog host while ignoring company', () => {
  const good = { bio: 'I build software.', blog: 'https://zia.saidi.pro' };
  assert.deepEqual(checkBio(good), []);
  assert.deepEqual(checkBio({ ...good, company: 42 }), []);
  for (const bad of [{ bio: '' }, { bio: ' '.repeat(5) }, { bio: 'x'.repeat(161) }, { blog: 'http://zia.saidi.pro' }, { blog: 'https://evil.example' }]) assert.equal(checkBio({ ...good, ...bad }).length, 1);
});
test('private matches count only added whole-word occurrences and reveal labels, never names', () => {
  const privateNames = ['fixture-private', 'xy'];
  assert.deepEqual(findPrivateNames({ managed: 'FIXTURE-PRIVATE remains' }, ['fixture-private'], privateNames), { count: 0, sections: [] });
  const result = findPrivateNames({ managed: 'fixture-private fixture-private', bio: 'FIXTURE-PRIVATE', projects: 'prefix-fixture-private xy' }, ['fixture-private'], privateNames);
  assert.deepEqual(result, { count: 3, sections: ['managed', 'bio', 'projects'] });
  assert.ok(!JSON.stringify(result).toLowerCase().includes('fixture-private'));
});

for (const text of ['Secretproj-based', 'secretproj_x', '(Secretproj)', 'SECRETPROJ.', 'foo_secretproj']) {
  test(`private boundaries include punctuation: ${text}`, () => {
    assert.equal(findPrivateNames({ managed: text }, [], ['secretproj']).count, 1);
  });
}
test('private boundaries exclude adjacent Unicode letters and digits', () => {
  for (const text of ['secretprojs', 'ésecretproj', 'secretproj٣']) {
    assert.equal(findPrivateNames({ managed: text }, [], ['secretproj']).count, 0);
  }
});

for (const [text, expected] of [
  ['Visit https://awna.ai/work now.', 'https://awna.ai/work'],
  ['Visit http://awna.ai/work now.', 'http://awna.ai/work'],
  ['<https://awna.ai/work>', 'https://awna.ai/work'],
  ['[label]: https://awna.ai/work', 'https://awna.ai/work'],
  ['Visit www.awna.ai/work now.', 'https://www.awna.ai/work'],
  ['(https://awna.ai/work.,;:!?)]', 'https://awna.ai/work'],
]) {
  test(`extracts URL form: ${text}`, () => assert.deepEqual(extractUrls(text), [expected]));
}

test('number guard retains angle-bracket claims but strips real tags and comments', () => {
  assert.deepEqual(checkNumbers('<90% in 2 weeks>', '', ''), [
    'Number 90 is not written in the facts.', 'Number 2 is not written in the facts.',
  ]);
  assert.deepEqual(checkNumbers('<!-- 99 > hidden --> <b title="100">40</b>', '', '40+'), []);
});
test('number guard checks Unicode decimal digits', () => {
  assert.deepEqual(checkNumbers('٤٠ projects and ४२ releases', '', ''), [
    'Number ٤٠ is not written in the facts.', 'Number ४२ is not written in the facts.',
  ]);
  assert.deepEqual(checkNumbers('٤٠ projects', '', '٤٠+'), []);
  assert.equal(checkNumbers('٤٠ projects', '', '١٤٠').length, 1);
});
test('number corpus boundaries reject decimal and grouped suffixes but accept plus', () => {
  for (const corpus of ['$2.40', '2,40', '140', '401', '٤40', '40٤']) {
    assert.equal(checkNumbers('40 projects', '', corpus).length, 1, corpus);
  }
  assert.deepEqual(checkNumbers('40 projects', '', '40+'), []);
});

test('number corpus boundaries reject prefixes of decimal and grouped numbers', () => {
  for (const [claim, corpus] of [['2', '$2.40'], ['2', '2,40'], ['1,000', '1,000,000'], ['٤', '٤.٢']]) {
    assert.equal(checkNumbers(claim, '', corpus).length, 1, `${claim} in ${corpus}`);
  }
  assert.deepEqual(checkNumbers('40 and 45,000', '', '40+ and 45,000+'), []);
});

for (const [text, expected] of [
  ['[z](ftp://evil.example/work (t))', 'ftp://evil.example/work'],
  ['[z](https://awna.ai/work (t))', 'https://awna.ai/work'],
  ['[z](//evil.example/work)', 'https://evil.example/work'],
  ['[label]: <//evil.example/work>', 'https://evil.example/work'],
  ['[label]: //evil.example/work', 'https://evil.example/work'],
  ['[r]: //evil.example/x', 'https://evil.example/x'],
  ['[r]:\n  //evil.example/x', 'https://evil.example/x'],
  ['[r]:\n  <https://evil.example>', 'https://evil.example'],
  ['<a href="//evil.example/work">z</a>', 'https://evil.example/work'],
  ['<img src="//evil.example/work">', 'https://evil.example/work'],
  ['[label]: <ftp://evil.example/work>', 'ftp://evil.example/work'],
  ['[label]: javascript:alert(1)', 'javascript:alert(1)'],
  ['[label]: /relative/work', '/relative/work'],
]) {
  test(`extracts additional destination form: ${text}`, async () => {
    assert.deepEqual(extractUrls(text), [expected]);
    const allowed = expected === 'https://awna.ai/work';
    const problems = await checkLinks(extractUrls(text), [], { fetch: async () => ({ status: 200 }) });
    assert.equal(problems.length, allowed ? 0 : 1);
  });
}

test('moved links normalize queries, fragments, trailing slashes and hostname case and report each once', () => {
  const redirects = [{ from: 'https://zia.saidi.pro/request-for-proposal', to: 'https://awna.ai/consulting/' }];
  assert.deepEqual(checkMovedLinks([
    'https://ZIA.saidi.pro/request-for-proposal/#fragment',
    'https://zia.saidi.pro/request-for-proposal',
    'https://zia.saidi.pro/request-for-proposal?ref=gh',
    'https://zia.saidi.pro/request-for-proposal/#fragment',
    'https://awna.ai/consulting/#talk-to-us',
    'https://zia.saidi.pro/about',
    'not a URL',
  ], redirects), [
    'A link points to https://zia.saidi.pro/request-for-proposal, which moved to https://awna.ai/consulting/; link the new page.',
  ]);
  assert.deepEqual(checkMovedLinks(['https://zia.saidi.pro/request-for-proposal?ref=gh'], redirects), [
    'A link points to https://zia.saidi.pro/request-for-proposal, which moved to https://awna.ai/consulting/; link the new page.',
  ]);
  assert.deepEqual(checkMovedLinks(['https://awna.ai/consulting/#talk-to-us', 'not a URL'], redirects), []);
});
