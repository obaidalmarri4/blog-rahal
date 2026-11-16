#!/usr/bin/env node
/**
 * مزامنة التدوينات الجديدة من مدوّنة Blogger إلى src/content/posts
 *
 * فيد Blogger هنا مضبوط على «مختصر» فلا يحمل نص التدوينة، لذا يُستخدم الفيد
 * لاكتشاف الجديد فقط، ثم تُسحب صفحة كل تدوينة ويُستخرج منها `post-body`.
 *
 * الاستعمال:
 *   node scripts/sync-blogger.mjs --dry-run       عرض الناقص بدون كتابة
 *   node scripts/sync-blogger.mjs                 استيراد كل الناقص
 *   node scripts/sync-blogger.mjs --limit 14      استيراد أحدث 14 ناقصة فقط
 *   node scripts/sync-blogger.mjs --abort-over 25 توقّف بلا كتابة إن زاد الناقص عن 25
 *
 * السكربت إضافي فقط: لا يعدّل ولا يحذف أي تدوينة موجودة.
 *
 * يُشغَّل آلياً من .github/workflows/sync-blogger.yml. هناك يُستعمل --abort-over
 * كصمّام أمان (عدد ناقص غير معقول يعني خللاً في الفيد لا دفعة حقيقية)، ويكتب
 * السكربت نتيجته في GITHUB_OUTPUT (imported/failed) وعناوين المستورَد في
 * الملف المسمّى بالمتغيّر SYNC_TITLES_FILE.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BLOG = 'https://rahal-k.blogspot.com';
const POSTS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/content/posts');
const PAGE_SIZE = 25; // Blogger يقصّ الصفحة الواحدة عند هذا الحد عملياً

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
function numberArg(flag) {
  const i = args.indexOf(flag);
  if (i === -1) return Infinity;
  const n = parseInt(args[i + 1], 10);
  if (!Number.isFinite(n) || n < 0) {
    console.error(`قيمة غير صالحة للخيار ${flag}`);
    process.exit(2);
  }
  return n;
}
const LIMIT = numberArg('--limit');
const ABORT_OVER = numberArg('--abort-over');

// ── أدوات مساعدة ────────────────────────────────────────────────────────────

/** نفس منطق getPostSlug في src/utils/posts.ts */
function cleanSlug(slug) {
  return slug.replace(/\.html$/, '').replace(/\//g, '-');
}

/** يحوّل رابط تدوينة كامل إلى slug: /2026/07/blog-post.html → 2026-07-blog-post */
function slugFromUrl(url) {
  return cleanSlug(url.replace(/^https?:\/\/[^/]+\//, ''));
}

function decodeEntities(s) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return s
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => (n.toLowerCase() in named ? named[n.toLowerCase()] : m));
}

/** استخراج نص مقروء من HTML التدوينة — الفواصل بين الكتل تصبح أسطراً */
function htmlToText(html) {
  return decodeEntities(
    html
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|h[1-6]|li|tr|blockquote)>/gi, '\n')
      .replace(/<[^>]+>/g, '')
  )
    .replace(/[ \t ]+/g, ' ')
    .split('\n')
    .map((l) => l.trim())
    .filter((l, i, a) => l !== '' || (i > 0 && a[i - 1] !== ''))
    .join('\n')
    .trim();
}

/**
 * يقتطع <div class="post-body entry-content"> ... </div> مع احترام التداخل.
 * regex وحده يفشل هنا لأن جسم التدوينة مليء بـ <div> متداخلة.
 */
function extractPostBody(html) {
  const open = /<div class=['"]post-body entry-content['"][^>]*>/i.exec(html);
  if (!open) return null;
  const start = open.index;
  let i = start + open[0].length;
  let depth = 1;
  const tag = /<\/?div\b[^>]*>/gi;
  tag.lastIndex = i;
  let m;
  while ((m = tag.exec(html)) !== null) {
    depth += m[0].startsWith('</') ? -1 : 1;
    if (depth === 0) return html.slice(start, m.index + m[0].length);
  }
  return null;
}

/** صور Blogger: الرابط الملفوف = النسخة الكبيرة، وسمة src = المصغّرة */
function extractImages(bodyHtml) {
  const images = [];
  const seen = new Set();

  const wrapped = /<a[^>]+href=["']([^"']*(?:googleusercontent|blogspot)[^"']*)["'][^>]*>\s*<img([^>]*)>/gi;
  let m;
  while ((m = wrapped.exec(bodyHtml)) !== null) {
    const src = /src=["']([^"']+)["']/i.exec(m[2]);
    if (!src) continue;
    const original = decodeEntities(m[1]);
    if (seen.has(original)) continue;
    seen.add(original);
    seen.add(decodeEntities(src[1]));
    images.push({
      original_url: original,
      thumbnail_url: decodeEntities(src[1]),
      alt: decodeEntities((/alt=["']([^"']*)["']/i.exec(m[2]) || ['', ''])[1]),
      local_path: '',
    });
  }

  // صور غير ملفوفة برابط
  const bare = /<img([^>]*)>/gi;
  while ((m = bare.exec(bodyHtml)) !== null) {
    const src = /src=["']([^"']+)["']/i.exec(m[1]);
    if (!src) continue;
    const url = decodeEntities(src[1]);
    if (seen.has(url) || !/googleusercontent|blogspot|ggpht/.test(url)) continue;
    seen.add(url);
    images.push({
      original_url: url,
      thumbnail_url: url,
      alt: decodeEntities((/alt=["']([^"']*)["']/i.exec(m[1]) || ['', ''])[1]),
      local_path: '',
    });
  }

  return images;
}

async function getJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'rahal-sync/1.0' } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

/** كل مداخل الفيد (اكتشاف فقط — الفيد مختصر ولا يحمل النص) */
async function fetchFeedEntries() {
  const first = await getJson(`${BLOG}/feeds/posts/default?alt=json&max-results=1`);
  const total = parseInt(first.feed['openSearch$totalResults'].$t, 10);
  const entries = [];
  for (let start = 1; start <= total; ) {
    const f = await getJson(
      `${BLOG}/feeds/posts/default?alt=json&max-results=${PAGE_SIZE}&start-index=${start}`
    );
    const batch = f.feed.entry || [];
    if (batch.length === 0) break;
    entries.push(...batch);
    start += batch.length;
  }
  return { total, entries };
}

function toRecord(entry) {
  const url = entry.link.find((l) => l.rel === 'alternate').href;
  return {
    slug: slugFromUrl(url),
    url,
    title: entry.title.$t,
    date: entry.published.$t,
    labels: (entry.category || []).map((c) => c.term),
  };
}

async function fetchPost(rec) {
  const res = await fetch(rec.url, { headers: { 'User-Agent': 'rahal-sync/1.0' } });
  if (!res.ok) throw new Error(`${res.status} ${rec.url}`);
  const html = await res.text();
  const body = extractPostBody(html);
  if (!body) throw new Error(`post-body غير موجود: ${rec.url}`);

  const images = extractImages(body);
  return {
    title: rec.title,
    date: rec.date,
    url: rec.url,
    slug: rec.url.replace(/^https?:\/\/[^/]+\//, ''), // نفس شكل الحقل في الملفات الحالية
    content_html: body,
    content_text: htmlToText(body),
    labels: rec.labels,
    images,
    image_count: images.length,
  };
}

// ── التنفيذ ─────────────────────────────────────────────────────────────────

const existing = new Set();
let maxPrefix = 0;
for (const f of fs.readdirSync(POSTS_DIR)) {
  if (!f.endsWith('.json')) continue;
  existing.add(cleanSlug(JSON.parse(fs.readFileSync(path.join(POSTS_DIR, f), 'utf-8')).slug));
  const p = /^(\d+)_/.exec(f);
  if (p) maxPrefix = Math.max(maxPrefix, parseInt(p[1], 10));
}
console.log(`📁 محلياً: ${existing.size} slug فريد (أعلى ترقيم ${maxPrefix})`);

const { total, entries } = await fetchFeedEntries();
console.log(`🌐 في المدوّنة: ${total} تدوينة (تم جلب ${entries.length} مدخلاً)`);

const missing = entries
  .map(toRecord)
  .filter((r) => !existing.has(r.slug))
  .sort((a, b) => new Date(b.date) - new Date(a.date));

console.log(`\n🆕 ناقصة محلياً: ${missing.length}`);
const targets = missing.slice(0, LIMIT);
targets.forEach((r, i) => console.log(`  ${i + 1}. ${r.date.slice(0, 10)}  ${r.slug}\n     ${r.title}`));

if (DRY_RUN) {
  console.log('\n(--dry-run: لم تُكتب أي ملفات)');
  process.exit(0);
}

if (missing.length > ABORT_OVER) {
  console.error(
    `\n⛔ الناقص (${missing.length}) يتجاوز حدّ الأمان (${ABORT_OVER}) — لم يُكتب شيء.` +
      '\n   إن كانت دفعة حقيقية فشغّل السكربت يدوياً بدون --abort-over.'
  );
  process.exit(1);
}

let n = maxPrefix;
const importedTitles = [];
for (const rec of targets) {
  try {
    const post = await fetchPost(rec);
    n += 1;
    const file = path.join(POSTS_DIR, `${String(n).padStart(4, '0')}_${rec.slug}.json`);
    fs.writeFileSync(file, JSON.stringify(post, null, 2) + '\n', 'utf-8');
    console.log(`  ✅ ${path.basename(file)}  (${post.image_count} صورة، ${post.content_text.length} حرفاً)`);
    importedTitles.push(rec.title.trim());
  } catch (err) {
    console.error(`  ❌ ${rec.slug}: ${err.message}`);
  }
}

const ok = importedTitles.length;
const failed = targets.length - ok;
console.log(`\nتمّ استيراد ${ok}/${targets.length}.`);
if (ok > 0) {
  console.log('التالي: إضافة مفاتيحها إلى src/data/taxonomy.json وإلا لن تظهر في صفحات القارات والدول.');
}

// مخرجات للتشغيل الآلي (GitHub Actions) — لا أثر لها عند التشغيل اليدوي
if (process.env.SYNC_TITLES_FILE) {
  fs.writeFileSync(process.env.SYNC_TITLES_FILE, importedTitles.map((t) => `${t}\n`).join(''), 'utf-8');
}
if (process.env.GITHUB_OUTPUT) {
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `imported=${ok}\nfailed=${failed}\n`);
}
