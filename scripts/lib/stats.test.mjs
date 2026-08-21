import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  THEMES,
  aggregateByMonth,
  assertVerifiableStats,
  buildStatRows,
  escapeXml,
  formatNumber,
  renderActivityCard,
  renderStatsCard,
} from './stats.mjs';

const rawStats = {
  totalContributions: 5_976,
  publicCommits: 12,
  restrictedContributions: 5_912,
  pullRequestsAllTime: 1_234,
  githubSinceYear: 2011,
  contributionDays: [
    { date: '2025-12-01', contributionCount: 2 },
    { date: '2025-12-31', contributionCount: 3 },
    { date: '2026-01-01', contributionCount: 7 },
  ],
};

describe('formatNumber', () => {
  test('formats finite numbers with en-US separators', () => {
    assert.equal(formatNumber(5_976), '5,976');
    assert.equal(formatNumber(0), '0');
  });

  test('rejects non-finite and non-number input', () => {
    for (const value of [NaN, Infinity, -Infinity, '5976']) {
      assert.throws(() => formatNumber(value), TypeError);
    }
  });
});

test('escapeXml escapes all XML-sensitive characters with ampersands first', () => {
  assert.equal(escapeXml(`&<>"'`), '&amp;&lt;&gt;&quot;&apos;');
  assert.equal(escapeXml('&<'), '&amp;&lt;');
  assert.equal(escapeXml('&lt;'), '&amp;lt;');
});

describe('aggregateByMonth', () => {
  test('groups contribution days into chronological months with English labels', () => {
    assert.deepEqual(
      aggregateByMonth([
        { date: '2026-08-01', contributionCount: 2 },
        { date: '2026-08-19', contributionCount: 5 },
        { date: '2026-09-03', contributionCount: 4 },
        { date: '2026-10-01', contributionCount: 1 },
      ]),
      [
        { key: '2026-08', label: 'Aug', total: 7 },
        { key: '2026-09', label: 'Sep', total: 4 },
        { key: '2026-10', label: 'Oct', total: 1 },
      ],
    );
  });

  test('keeps December before the following January', () => {
    assert.deepEqual(
      aggregateByMonth([
        { date: '2025-12-31', contributionCount: 3 },
        { date: '2026-01-01', contributionCount: 4 },
      ]).map(({ key }) => key),
      ['2025-12', '2026-01'],
    );
  });
});

describe('assertVerifiableStats', () => {
  test('rejects a token that cannot see private contributions', () => {
    assert.throws(
      () => assertVerifiableStats({ ...rawStats, restrictedContributions: 0 }),
      /token cannot see private contributions.*ALLOW_ZERO_PRIVATE=1/i,
    );
  });

  test('allows zero private contributions only with the explicit override', () => {
    const raw = { ...rawStats, restrictedContributions: 0 };
    assert.equal(assertVerifiableStats(raw, { allowZeroPrivate: true }), raw);
  });

  test('rejects unverifiable commit contribution fields', () => {
    for (const [field, values] of [
      ['publicCommits', [undefined, '12', -1]],
      ['restrictedContributions', [undefined, '5912', -1]],
    ]) {
      for (const value of values) {
        assert.throws(
          () => assertVerifiableStats({ ...rawStats, [field]: value }),
          new RegExp(`${field}.*cannot be verified`, 'i'),
        );
      }
    }
  });

  test('rejects invalid total contributions', () => {
    for (const totalContributions of [0, -1, 1.5, undefined]) {
      assert.throws(
        () => assertVerifiableStats({ ...rawStats, totalContributions }),
        /totalContributions/,
      );
    }
  });

  test('rejects a missing all-time pull request count', () => {
    assert.throws(
      () => assertVerifiableStats({ ...rawStats, pullRequestsAllTime: undefined }),
      /pullRequestsAllTime/,
    );
  });
});

test('buildStatRows returns the four ordered rows and combines public and private commits', () => {
  assert.deepEqual(buildStatRows(rawStats), [
    { label: 'Contributions · last 12 months', value: '5,976' },
    { label: 'Commits · last 12 months', value: '5,924' },
    { label: 'Pull requests opened · all time', value: '1,234' },
    { label: 'On GitHub since', value: '2011' },
  ]);
});

for (const [name, render, expectedNumbers] of [
  ['Stats', renderStatsCard, /5,976|1,234|5,924/],
  ['Activity', renderActivityCard, /Dec: 5, Jan: 7, peak 7 in Jan/],
]) {
  test(`render${name}Card emits a self-contained accessible SVG`, () => {
    const svg = render(rawStats, THEMES.light);
    const withoutNamespace = svg.replace('xmlns="http://www.w3.org/2000/svg"', '');

    assert.match(svg, /^<svg/);
    assert.match(svg, /<\/svg>$/);
    assert.match(svg, /role="img"/);
    assert.match(svg, expectedNumbers);
    assert.doesNotMatch(svg, /<script/i);
    assert.doesNotMatch(withoutNamespace, /https?:\/\//i);
  });
}

test('regression: invisible private contributions throw instead of emitting a low commit count', () => {
  const raw = { ...rawStats, restrictedContributions: 0 };
  assert.throws(() => {
    assertVerifiableStats(raw);
    renderStatsCard(raw, THEMES.light);
  }, /published commit count would be wrong/i);
});

test('rendered card coordinate attributes have at most two decimal places', () => {
  for (const render of [renderStatsCard, renderActivityCard]) {
    const svg = render(rawStats, THEMES.light);
    const numericAttributes = svg.match(/(?:x|y|width|height)="([0-9.]+)"/g) ?? [];

    assert.ok(numericAttributes.length > 0);
    for (const attribute of numericAttributes) {
      assert.doesNotMatch(attribute, /\.\d{3,}/);
    }
  }
});

test('renderActivityCard emits every month track before the bars', () => {
  const svg = renderActivityCard(rawStats, THEMES.light);
  const trackMarker = `fill="${THEMES.light.track}"`;
  const trackIndexes = [...svg.matchAll(new RegExp(trackMarker, 'g'))]
    .map(({ index }) => index);
  const firstBarIndex = svg.match(
    new RegExp(`<rect[^>]+rx="2" fill="${THEMES.light.accent}"`),
  )?.index ?? -1;

  assert.equal(trackIndexes.length, aggregateByMonth(rawStats.contributionDays).length);
  assert.ok(firstBarIndex >= 0);
  assert.ok(trackIndexes.every((index) => index < firstBarIndex));
});
