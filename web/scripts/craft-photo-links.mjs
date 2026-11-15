// Finds a photo link for every "coming soon" craft on the globe (src/crafts/world/).
// Each craft names a Wikipedia article; we take that article's lead image from
// Wikimedia Commons (free licences only) and record a 640px thumbnail URL plus
// its credit in src/crafts/world/photos.json. Nothing is downloaded: the globe
// loads the images straight from upload.wikimedia.org.
//
//   node scripts/craft-photo-links.mjs

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const worldDir = join(here, '../src/crafts/world');
const UA = 'SenecaiCraftCatalog/0.1 (Junction hackathon project)';

const crafts = [];
for (const r of ['europe', 'asia', 'africa', 'americas', 'oceania']) {
  const mod = await import(join(worldDir, `${r}.ts`));
  crafts.push(...Object.values(mod).flat());
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function api(host, params) {
  const url = `https://${host}/w/api.php?${new URLSearchParams({ format: 'json', formatversion: '2', ...params })}`;
  for (let attempt = 0; ; attempt++) {
    let wait = 5000 * (attempt + 1);
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) });
      if (res.ok) return res.json();
      if (attempt >= 6) throw new Error(`${res.status} ${url}`);
      // Rate limited: wait as long as the server asks.
      const after = Number(res.headers.get('retry-after'));
      if (after) wait = Math.max(wait, after * 1000);
    } catch (e) {
      if (attempt >= 6) throw e;
    }
    await sleep(wait);
  }
}
const chunks = (xs, n) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));
const stripHtml = (s = '') => s.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
const key = (f) => f.replace(/ /g, '_');

// 1. Lead image file name for each article (following redirects).
const fileFor = new Map(); // wiki title as written in the data -> File name
const wikidataFor = new Map(); // Wikidata item -> wiki titles without a pageimage
for (const batch of chunks([...new Set(crafts.map((c) => c.wiki))], 50)) {
  // Prop modules page their results; keep asking until there is no `continue`.
  const data = { query: { normalized: [], redirects: [], pages: [] } };
  let cont = {};
  do {
    const part = await api('en.wikipedia.org', { action: 'query', prop: 'pageimages', piprop: 'name', pilimit: 'max', redirects: '1', titles: batch.join('|'), ...cont });
    await sleep(1000);
    data.query.normalized.push(...(part.query.normalized ?? []));
    data.query.redirects.push(...(part.query.redirects ?? []));
    data.query.pages.push(...part.query.pages);
    cont = part.continue ?? null;
  } while (cont);
  const from = new Map(); // resolved title -> titles that led to it
  const link = (to, f) => from.set(to, [...(from.get(to) ?? []), f]);
  for (const t of batch) link(t, t);
  for (const n of data.query.normalized ?? []) for (const f of from.get(n.from) ?? [n.from]) link(n.to, f);
  for (const r of data.query.redirects ?? []) for (const f of from.get(r.from) ?? [r.from]) link(r.to, f);
  for (const p of data.query.pages) if (p.pageimage) for (const t of from.get(p.title) ?? []) fileFor.set(t, p.pageimage);
  // Some articles opt their lead image out of pageimages: remember their Wikidata item instead.
  const rest = data.query.pages.filter((p) => !p.pageimage && !p.missing);
  if (rest.length) {
    const props = await api('en.wikipedia.org', { action: 'query', prop: 'pageprops', ppprop: 'wikibase_item', titles: rest.map((p) => p.title).join('|') });
    for (const p of props.query.pages) if (p.pageprops?.wikibase_item) wikidataFor.set(p.pageprops.wikibase_item, from.get(p.title) ?? []);
  }
  await sleep(300);
}

// ...and fall back to the item's Wikidata image (P18), which is always a Commons file.
for (const ids of chunks([...wikidataFor.keys()], 50)) {
  const wd = await api('www.wikidata.org', { action: 'wbgetentities', props: 'claims', ids: ids.join('|') });
  for (const [id, e] of Object.entries(wd.entities ?? {})) {
    const img = e.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
    if (img) for (const t of wikidataFor.get(id) ?? []) fileFor.set(t, key(img));
  }
  await sleep(1000);
}

// 2. Commons metadata and a 640px thumbnail URL. Files only on English Wikipedia are non-free: skip them.
const info = new Map();
for (const batch of chunks([...new Set(fileFor.values())], 40)) {
  const data = await api('commons.wikimedia.org', {
    action: 'query',
    prop: 'imageinfo',
    iiprop: 'url|extmetadata',
    iiurlwidth: '640',
    titles: batch.map((f) => `File:${f}`).join('|'),
  });
  for (const p of data.query.pages) {
    const ii = p.imageinfo?.[0];
    if (!ii || p.missing) continue;
    const m = ii.extmetadata ?? {};
    info.set(key(p.title.replace(/^File:/, '')), {
      src: ii.thumburl ?? ii.url,
      author: stripHtml(m.Artist?.value).slice(0, 60) || 'Unknown',
      license: stripHtml(m.LicenseShortName?.value) || 'see source',
      source: ii.descriptionurl,
    });
  }
  await sleep(300);
}

const photos = {};
const missing = [];
for (const c of [...crafts].sort((a, b) => a.id.localeCompare(b.id))) {
  const file = fileFor.get(c.wiki);
  const meta = file && info.get(key(file));
  if (meta) photos[c.id] = { src: meta.src, alt: c.name, author: meta.author, license: meta.license, source: meta.source };
  else missing.push(`${c.id} (${c.wiki})`);
}
writeFileSync(join(worldDir, 'photos.json'), JSON.stringify(photos, null, 2) + '\n');
console.log(`${Object.keys(photos).length} of ${crafts.length} crafts have a photo link`);
if (missing.length) console.log(`no free lead image for ${missing.length}:\n  ${missing.join('\n  ')}`);
