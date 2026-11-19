export const MARKERS = Object.freeze([
  '<!-- profile:managed:start -->',
  '<!-- profile:managed:end -->',
  '<!-- profile:projects:start -->',
  '<!-- profile:projects:end -->',
]);

export function splitReadme(text) {
  let cursor = 0;
  const regions = [];
  for (const marker of MARKERS) {
    const index = text.indexOf(marker);
    if (index < cursor || index < 0 || text.indexOf(marker, index + marker.length) !== -1) {
      throw new Error('README markers must appear exactly once and in order.');
    }
    regions.push(text.slice(cursor, index));
    cursor = index + marker.length;
  }
  regions.push(text.slice(cursor));
  const [before, managed, between, projects, after] = regions;
  return { before, managed, between, projects, after };
}

export function joinReadme({ before, managed, between, projects, after }) {
  return before + MARKERS[0] + managed + MARKERS[1] + between + MARKERS[2]
    + projects + MARKERS[3] + after;
}
