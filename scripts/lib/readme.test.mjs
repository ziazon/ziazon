import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { splitReadme, joinReadme, MARKERS } from './readme.mjs';

const sample = `before${MARKERS[0]}managed${MARKERS[1]}between${MARKERS[2]}projects${MARKERS[3]}after`;
test('splits all five byte-exact regions and joins them', () => {
  const parts = splitReadme(sample);
  assert.deepEqual(parts, { before: 'before', managed: 'managed', between: 'between', projects: 'projects', after: 'after' });
  assert.equal(joinReadme(parts), sample);
});
for (const marker of MARKERS) {
  test(`rejects missing ${marker}`, () => assert.throws(() => splitReadme(sample.replace(marker, '')), /markers/i));
  test(`rejects duplicated ${marker}`, () => assert.throws(() => splitReadme(sample + marker), /markers/i));
}
test('rejects out-of-order markers', () => {
  assert.throws(() => splitReadme(MARKERS.toReversed().join('')), /markers/i);
});
test('round-trips the real README without changing approved content', async () => {
  const text = await readFile(new URL('../../README.md', import.meta.url), 'utf8');
  assert.equal(joinReadme(splitReadme(text)), text);
});
