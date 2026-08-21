const MONTH_LABELS = Object.freeze([
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]);

const light = Object.freeze({
  bg: '#ffffff', border: '#dbdbdb', title: '#075985', label: '#424242',
  value: '#333334', accent: '#0ab7f9', muted: '#696969', track: '#e7e7e7',
});

const dark = Object.freeze({
  bg: '#0d1117', border: '#30363d', title: '#56c9e6', label: '#c9d1d9',
  value: '#ffffff', accent: '#0ab7f9', muted: '#8b949e', track: '#21262d',
});

export const THEMES = Object.freeze({ light, dark });

function round(value) {
  return Number(value.toFixed(2));
}

export function formatNumber(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError('formatNumber requires a finite number.');
  }
  return new Intl.NumberFormat('en-US').format(value);
}

export function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

export function assertVerifiableStats(raw, { allowZeroPrivate = false } = {}) {
  if (!Number.isInteger(raw.totalContributions) || raw.totalContributions <= 0) {
    throw new Error('totalContributions must be a positive integer.');
  }
  for (const field of ['publicCommits', 'restrictedContributions']) {
    if (!Number.isInteger(raw[field]) || raw[field] < 0) {
      throw new Error(`${field} must be a non-negative integer; stats cannot be verified.`);
    }
  }
  if (raw.restrictedContributions === 0 && !allowZeroPrivate) {
    throw new Error(
      'The token cannot see private contributions, so the published commit count would be wrong. Set ALLOW_ZERO_PRIVATE=1 only if zero private contributions is genuinely correct.',
    );
  }
  if (!Number.isInteger(raw.pullRequestsAllTime) || raw.pullRequestsAllTime <= 0) {
    throw new Error('pullRequestsAllTime must be a positive integer.');
  }
  return raw;
}

export function aggregateByMonth(contributionDays) {
  const months = new Map();
  for (const { date, contributionCount } of contributionDays) {
    const [year, month] = date.split('-');
    const key = `${year}-${month}`;
    const existing = months.get(key);
    if (existing) {
      existing.total += contributionCount;
    } else {
      months.set(key, {
        key,
        label: MONTH_LABELS[Number(month) - 1],
        total: contributionCount,
      });
    }
  }
  return [...months.values()].sort((a, b) => a.key.localeCompare(b.key));
}

export function buildStatRows(raw) {
  return [
    { label: 'Contributions · last 12 months', value: formatNumber(raw.totalContributions) },
    { label: 'Commits · last 12 months', value: formatNumber(raw.publicCommits + raw.restrictedContributions) },
    { label: 'Pull requests opened · all time', value: formatNumber(raw.pullRequestsAllTime) },
    { label: 'On GitHub since', value: String(raw.githubSinceYear) },
  ];
}

function svgShell({ title, description, theme, content }) {
  return `<svg width="400" height="180" viewBox="0 0 400 180" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="cardTitle cardDesc"><title id="cardTitle">${escapeXml(title)}</title><desc id="cardDesc">${escapeXml(description)}</desc><style>text { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Ubuntu, 'Helvetica Neue', Sans-Serif; }</style><rect x="0.5" y="0.5" width="399" height="179" rx="8" fill="${escapeXml(theme.bg)}" stroke="${escapeXml(theme.border)}" stroke-width="1"/>${content}</svg>`;
}

function cardHeading(title, theme) {
  return `<text x="24" y="34" font-size="15px" font-weight="700" fill="${escapeXml(theme.title)}">${escapeXml(title)}</text><rect x="24" y="44" width="36" height="2" fill="${escapeXml(theme.accent)}"/>`;
}

export function renderStatsCard(raw, theme) {
  const rows = buildStatRows(raw);
  const description = rows.map(({ label, value }) => `${label}: ${value}`).join(', ');
  const rowMarkup = rows.map(({ label, value }, index) => {
    const y = 76 + index * 26;
    return `<text x="24" y="${escapeXml(y)}" font-size="12px" fill="${escapeXml(theme.label)}">${escapeXml(label)}</text><text x="376" y="${escapeXml(y)}" text-anchor="end" font-size="13px" font-weight="700" fill="${escapeXml(theme.value)}">${escapeXml(value)}</text>`;
  }).join('');
  return svgShell({
    title: 'GitHub activity',
    description,
    theme,
    content: `${cardHeading('GitHub activity', theme)}${rowMarkup}`,
  });
}

export function renderActivityCard(raw, theme) {
  const months = aggregateByMonth(raw.contributionDays).slice(-12);
  const maxTotal = Math.max(0, ...months.map(({ total }) => total));
  const peak = months.reduce(
    (latest, month) => (month.total >= latest.total ? month : latest),
    { label: 'n/a', total: 0 },
  );
  const gap = 4;
  const chartWidth = 352;
  const barWidth = months.length
    ? (chartWidth - gap * (months.length - 1)) / months.length
    : chartWidth;
  const tracks = months.map((_, index) => {
    const x = round(24 + index * (barWidth + gap));
    return `<rect x="${escapeXml(x)}" y="70" width="${escapeXml(round(barWidth))}" height="78" rx="2" fill="${escapeXml(theme.track)}"/>`;
  }).join('');
  const bars = months.map(({ label, total }, index) => {
    const x = round(24 + index * (barWidth + gap));
    const height = round(maxTotal === 0
      ? 1
      : Math.max(total > 0 ? 2 : 0, (total / maxTotal) * 78));
    const y = round(148 - height);
    const center = round(x + barWidth / 2);
    return `<rect x="${escapeXml(x)}" y="${escapeXml(y)}" width="${escapeXml(round(barWidth))}" height="${escapeXml(height)}" rx="2" fill="${escapeXml(theme.accent)}"/><text x="${escapeXml(center)}" y="164" text-anchor="middle" font-size="9px" fill="${escapeXml(theme.muted)}">${escapeXml(label)}</text>`;
  }).join('');
  const peakText = `peak ${formatNumber(maxTotal)} in ${peak.label}`;
  const description = [
    ...months.map(({ label, total }) => `${label}: ${formatNumber(total)}`),
    peakText,
  ].join(', ');
  const caption = `<text x="376" y="52" text-anchor="end" font-size="10px" fill="${escapeXml(theme.muted)}">${escapeXml(peakText)}</text>`;
  return svgShell({
    title: 'Contributions by month',
    description,
    theme,
    content: `${cardHeading('Contributions by month', theme)}${caption}${tracks}${bars}`,
  });
}
