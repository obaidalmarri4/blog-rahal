#!/usr/bin/env node
/**
 * بوابة الكتابة في لوحة التحرير: القائمة، تعديل بيانات التدوينة، والحذف.
 *
 * يشغّل الحزمة التي تُنشر فعلاً (‎.vercel/output‎) أمام GitHub وهمي في الذاكرة
 * (scripts/lib/fake-github.mjs) مملوء بتدوينات المشروع الحالية، ويتحقق مما يصل إلى
 * «المستودع» بعد كل عملية: ما الذي كُتب، وما الذي بقي حرفاً بحرف.
 *
 * الاستعمال (يحتاج بناءً حديثاً، و Node 22.18 فما فوق):
 *
 *   npm run build && node scripts/studio-write-check.mjs
 *
 * شغّله بعد أي تغيير في src/lib/studio/{github,store,taxonomy,validate,config}.ts أو صفحات
 * ‎/studio‎. لا يلمس GitHub الحقيقي ولا يحتاج توكناً. يخرج برمز 1 عند أي فحص فاشل.
 * (من يفتح اللوحة ومن لا يفتحها: scripts/studio-access-check.mjs.)
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { Transform } from '@tiptap/pm/transform';
import { createFakeBlob, fakeJpeg } from './lib/fake-blob.mjs';
import { createFakeGitHub } from './lib/fake-github.mjs';
import { extractImages, htmlToText } from './lib/post-html.mjs';
import { readRemovedSlugs } from './lib/removed-posts.mjs';
import { createOutputServer } from './lib/vercel-output-server.mjs';
import { bodyForSave, loadBody, parseBody, schema } from '../src/lib/studio/document.js';
import { buildStudioIndex } from '../src/lib/studio/index-plugin.mjs';
import { expandRawBlocks, splitRawBlocks } from '../src/lib/studio/raw-blocks.js';
import { COOKIE_NAME, issueSession } from '../src/lib/studio/session.ts';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT_DIR = path.join(ROOT, '.vercel/output');
const HOST = 'blog-rahal.vercel.app';
const ORIGIN = `https://${HOST}`;
const POSTS = 'src/content/posts';
const TAXONOMY = 'src/data/taxonomy.json';
const REMOVED = 'src/data/removed-posts.json';
const BRANCH = 'studio-sandbox';
const REPO = 'obaidalmarri4/blog-rahal';
const DEPLOY_CONTEXT = 'Vercel – blog-rahal';

if (!fs.existsSync(path.join(OUTPUT_DIR, 'config.json'))) {
  console.error('لا يوجد ناتج بناء (.vercel/output) — شغّل npm run build أولاً.');
  process.exit(1);
}

const KEY = crypto.randomBytes(32).toString('base64url');
const TOKEN = `test-token-${crypto.randomBytes(12).toString('hex')}`;

const github = await createFakeGitHub({ root: ROOT, token: TOKEN, repo: REPO, branch: BRANCH, seed: [POSTS, TAXONOMY, REMOVED] });

process.env.STUDIO_KEY = KEY;
process.env.VERCEL_ENV = 'production';
process.env.STUDIO_GITHUB_TOKEN = TOKEN;
process.env.STUDIO_GITHUB_API = github.url;
process.env.STUDIO_BRANCH = BRANCH;
delete process.env.STUDIO_REPO;
delete process.env.STUDIO_DEPLOY_CONTEXT;

const output = await createOutputServer(OUTPUT_DIR);
const port = await output.listen();
const cookie = issueSession(KEY);

/** كل ما ردّت به اللوحة — يُفحص في الآخر أن التوكن لم يظهر في شيء منه */
const everything = [];

function request(pathname, { method = 'GET', form, json, raw, paired = true, headers = {} } = {}) {
  const body = raw
    ? raw.body
    : json !== undefined
      ? typeof json === 'string'
        ? json
        : JSON.stringify(json)
      : form
        ? new URLSearchParams(form).toString()
        : undefined;
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: pathname,
        method,
        headers: {
          host: HOST,
          'x-forwarded-proto': 'https',
          ...(paired ? { cookie: `${COOKIE_NAME}=${cookie}` } : {}),
          ...(method !== 'GET'
            ? {
                origin: ORIGIN,
                'sec-fetch-site': 'same-origin',
                'content-type': raw ? raw.type : json !== undefined ? 'application/json' : 'application/x-www-form-urlencoded',
                'content-length': Buffer.byteLength(body ?? ''),
              }
            : {}),
          ...headers,
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf-8');
          everything.push(JSON.stringify(res.headers), text);
          resolve({ status: res.statusCode, location: res.headers.location ?? '', text });
        });
      }
    );
    req.on('error', reject);
    req.end(body);
  });
}

// ── أدوات ───────────────────────────────────────────────────────────────────

let failures = 0;
let total = 0;
const section = (title) => console.log(`\n${title}`);
function check(label, ok, detail = '') {
  total++;
  if (!ok) failures++;
  console.log(`  ${ok ? '✓' : '✗'} ${label}${!ok && detail ? `\n      ${detail}` : ''}`);
}

const unescapeHtml = (value) =>
  value.replace(/&quot;|&#34;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

const postPath = (slug) => `/studio/post/${encodeURIComponent(slug)}`;
const commits = () => github.log.filter((entry) => entry.kind === 'commit');
const lastCommit = () => commits().at(-1);
const taxonomy = () => JSON.parse(github.read(TAXONOMY));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** يفتح صفحة التدوينة كما يفعل المتصفح ويعيد القيم المعروضة — منها يُبنى النموذج */
async function open(slug) {
  const page = await request(postPath(slug));
  const raw = /name="base" value="([^"]*)"/.exec(page.text)?.[1];
  return { page, base: raw ? JSON.parse(unescapeHtml(raw)) : null };
}

/** حقول النموذج كما يرسلها المتصفح: القيم المعروضة مع ما غيّره المستخدم */
function fields(base, changes = {}) {
  const values = { ...base, ...changes };
  const form = [
    ['action', 'save'],
    ['base', JSON.stringify(base)],
    ['title', values.title],
    ['date', values.date],
    ['labels', values.labels.join('\n')],
    ['type', values.classification.type],
    ['country', values.classification.countries?.[0] ?? ''],
    ['category', values.classification.category ?? 'عام'],
  ];
  for (const country of values.classification.countries?.slice(1) ?? []) form.push(['countries', country]);
  return form;
}

const save = async (slug, changes, base) => request(postPath(slug), { method: 'POST', form: fields(base ?? (await open(slug)).base, changes) });
const remove = (slug, word = 'حذف') => request(postPath(slug), { method: 'POST', form: [['action', 'delete'], ['confirm', word]] });

const index = buildStudioIndex();
const fileOf = (slug) => `${POSTS}/${index.find((entry) => entry.slug === slug).file}`;
const readPost = (slug) => JSON.parse(github.read(fileOf(slug)));

const ORIGINAL_TAXONOMY = github.read(TAXONOMY);
const A = index[0].slug; // تدوينة مصنّفة
const UNCLASSIFIED = index.map((entry) => entry.slug).find((slug) => !taxonomy().posts[slug]);
const VICTIMS = index.slice(-8).map((entry) => entry.slug); // للحذف

// ── 1. القائمة ──────────────────────────────────────────────────────────────

section('١. القائمة');

const list = await request('/studio');
const rows = list.text.match(/data-post /g)?.length ?? 0;
check(`تعرض كل التدوينات (${index.length})`, list.status === 200 && rows === index.length, `الحالة ${list.status}، الصفوف ${rows}`);
check('غير المصنّفة معلَّمة', (list.text.match(/data-cls="none"/g)?.length ?? 0) === index.filter((entry) => !taxonomy().posts[entry.slug]).length);
check('لا يُجلب أي ملف تدوينة حين يطابق الفرعُ البناءَ (الفهرس يكفي)', github.count('raw') === 0, `ملفات جُلبت: ${github.count('raw')}`);
check('طلب واحد إلى GitHub لفتح القائمة', github.count('snapshot') === 1);

// ── 2. تعديل البيانات ───────────────────────────────────────────────────────

section('٢. تعديل العنوان والتاريخ والوسوم');

const before = readPost(A);
const beforeRaw = github.read(fileOf(A));
const opened = await open(A);
check('صفحة التدوينة تفتح وتحمل قيمها', opened.page.status === 200 && opened.base?.title === before.title, `الحالة ${opened.page.status}`);

const NEW_TITLE = 'عنوان جديد من البوابة «تجربة»';
let res = await save(A, { title: NEW_TITLE });
let after = readPost(A);
check('حفظ العنوان يحوّل إلى الصفحة نفسها مع رقم الـcommit', res.status === 303 && new RegExp(`^${postPath(A).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\?saved=[0-9a-f]{40}$`).test(res.location), `${res.status} ${res.location}`);
check('العنوان تغيّر في ملف التدوينة', after.title === NEW_TITLE);
check('باقي حقول الملف لم يتغيّر فيها حرف', same({ ...after, title: before.title }, before));
check('تنسيق الملف محفوظ (مسافتان، والسطر الأخير كما كان)', github.read(fileOf(A)) === JSON.stringify(after, null, 2) + (beforeRaw.endsWith('\n') ? '\n' : ''));
check('commit واحد يمسّ ملف التدوينة وحده', commits().length === 1 && same(lastCommit().added, [fileOf(A)]) && lastCommit().deleted.length === 0, JSON.stringify(lastCommit()));
check('ملف التصنيف لم يُمسّ', github.read(TAXONOMY) === ORIGINAL_TAXONOMY);
check('سطر الـcommit يذكر اللوحة والعنوان', lastCommit().headline.startsWith('لوحة التحرير: تعديل بيانات') && lastCommit().headline.includes('عنوان جديد'));
check('الـcommit مبنيّ على رأس الفرع الذي قُرئ', lastCommit().oid === github.head && res.location.endsWith(github.head));

const rawBefore = github.count('raw');
const relisted = await request('/studio');
check('القائمة تعرض العنوان الجديد فوراً (قبل أي بناء)', relisted.text.includes('عنوان جديد من البوابة'));
check('ولا تجلب إلا الملف الذي تغيّر', github.count('raw') - rawBefore === 1, `ملفات جُلبت: ${github.count('raw') - rawBefore}`);

res = await save(A, { date: '2020-01-15' });
check('تغيير التاريخ يغيّر اليوم ويُبقي الساعة وفرق التوقيت', readPost(A).date === `2020-01-15${before.date.slice(10)}`, readPost(A).date);

const LABELS = ['رحلات', 'هايكنج، راجلة', 'Rahal Alkhobar'];
res = await save(A, { labels: LABELS });
check('الوسوم تُحفظ كما كُتبت — وسم فيه فاصلة يبقى وسماً واحداً', same(readPost(A).labels, LABELS), JSON.stringify(readPost(A).labels));

let count = commits().length;
res = await save(A, {});
check('حفظ بلا تغيير لا يكتب شيئاً', res.status === 303 && res.location.endsWith('?saved=none') && commits().length === count, `${res.status} ${res.location}`);

// ── 3. التصنيف ──────────────────────────────────────────────────────────────

section('٣. التصنيف');

const taxonomyBefore = taxonomy();
const fileBefore = github.read(fileOf(UNCLASSIFIED));
res = await save(UNCLASSIFIED, { classification: { type: 'travel', countries: ['اليابان', 'الصين'] } });
let tax = taxonomy();
check('تصنيف رحلة: القارّة تُملأ من الدولة الأولى', res.status === 303 && same(tax.posts[UNCLASSIFIED], { continent: 'آسيا', countries: ['اليابان', 'الصين'], type: 'travel' }), JSON.stringify(tax.posts[UNCLASSIFIED]));
check('المفتاح الجديد يُضاف في آخر الملف، وترتيب الباقي كما هو', same(Object.keys(tax.posts).slice(0, -1), Object.keys(taxonomyBefore.posts)) && Object.keys(tax.posts).at(-1) === UNCLASSIFIED);
check('باقي ملف التصنيف لم يتغيّر فيه حرف', same({ ...tax, posts: { ...tax.posts, [UNCLASSIFIED]: undefined } }, { ...taxonomyBefore, posts: { ...taxonomyBefore.posts, [UNCLASSIFIED]: undefined } }));
check('commit يمسّ ملف التصنيف وحده', same(lastCommit().added, [TAXONOMY]) && github.read(fileOf(UNCLASSIFIED)) === fileBefore);

res = await save(UNCLASSIFIED, { classification: { type: 'other', category: 'تراث محلي' } });
tax = taxonomy();
check('تصنيف موضوع آخر: نفس شكل المفاتيح الحالية وفي مكانه', same(tax.posts[UNCLASSIFIED], { continent: null, countries: [], type: 'other', category: 'تراث محلي' }) && Object.keys(tax.posts).at(-1) === UNCLASSIFIED);

res = await save(UNCLASSIFIED, { classification: { type: 'none' } });
check('«بلا تصنيف» يحذف المفتاح، والملف يعود مطابقاً للأصل بايتاً ببايت', github.read(TAXONOMY) === ORIGINAL_TAXONOMY);

// ── 4. مدخلات مرفوضة ────────────────────────────────────────────────────────

section('٤. مدخلات مرفوضة');

count = commits().length;
const tomorrowPlus = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
for (const [label, changes] of [
  ['عنوان فارغ', { title: '   ' }],
  ['عنوان أطول من 300 حرف', { title: 'ط'.repeat(301) }],
  ['تاريخ في المستقبل', { date: tomorrowPlus }],
  ['تاريخ غير موجود', { date: '2024-02-31' }],
  ['رحلة بلا دولة', { classification: { type: 'travel', countries: [] } }],
  ['دولة غير معروفة', { classification: { type: 'travel', countries: ['أتلانتس'] } }],
  ['فئة غير معروفة', { classification: { type: 'other', category: 'سياسة' } }],
  ['وسم أطول من 120 حرفاً', { labels: ['و'.repeat(121)] }],
]) {
  res = await save(A, changes);
  check(`${label}: رُفض (422) مع رسالة`, res.status === 422 && res.text.includes('studio-error'), `الحالة ${res.status}`);
}
res = await request(postPath(A), { method: 'POST', form: [['action', 'save'], ['base', '{معطوب'], ['title', 'x']] });
check('نموذج بلا قيمه الأصلية: رُفض (422)', res.status === 422);
check('لا شيء مما رُفض وصل المستودع', commits().length === count);

const HOSTILE = '<script>alert(1)</script><img src=x onerror=alert(2)> & "اقتباس"';
res = await save(A, { title: HOSTILE });
// يُفحص كما يبنيه المتصفح: العنوان نص في الصفحة، لا وسوم
const pages = [(await open(A)).page.text, (await request('/studio')).text].map((html) => new JSDOM(html).window.document);
check(
  'عنوان فيه وسوم HTML يُحفظ نصاً، ويُعرض نصاً في صفحته وفي القائمة',
  readPost(A).title === HOSTILE &&
    pages[0].querySelector('h1').textContent === HOSTILE &&
    pages[0].querySelector('input[name=title]').value === HOSTILE &&
    pages.every((document) => !document.querySelector('img[onerror]') && ![...document.scripts].some((script) => script.textContent.includes('alert('))),
  readPost(A).title
);

// ── 5. التزامن ──────────────────────────────────────────────────────────────

section('٥. تزامن مع بوت المزامنة ومع جهاز آخر');

const BOT_FILE = `${POSTS}/9999_bot-post.json`;
const BOT_POST = JSON.stringify({ title: 'تدوينة البوت', date: '2026-11-20T10:00:00+03:00', url: '', slug: 'bot-post', content_html: '', content_text: '', labels: [], images: [], image_count: 0 }, null, 2) + '\n';
let stale = github.count('stale');
github.beforeCommit.push(() => github.push({ additions: { [BOT_FILE]: BOT_POST }, headline: 'مزامنة آلية' }));
res = await save(A, { title: 'تعديل تزامن مع البوت' });
check('دفعة من البوت بين القراءة والكتابة: الحفظ ينجح بإعادة المحاولة', res.status === 303 && github.count('stale') - stale === 1, `${res.status}، مرفوضات: ${github.count('stale') - stale}`);
check('لم يضع شيء: تدوينة البوت وتعديل اللوحة معاً في المستودع', github.read(BOT_FILE) === BOT_POST && readPost(A).title === 'تعديل تزامن مع البوت');
check('القائمة تعرض تدوينة البوت التي لم يعرفها البناء', (await request('/studio')).text.includes('تدوينة البوت'));

// كتابتان في اللحظة نفسها: GitHub الحقيقي يردّ على الخاسرة بـFORBIDDEN «is at … but expected …» لا STALE_DATA
stale = github.count('stale');
github.duringCommit.push(() => github.push({ additions: { [BOT_FILE]: `${BOT_POST}\n` }, headline: 'كتابة سبقت في اللحظة نفسها' }));
res = await save(A, { title: 'تعديل خسر السباق ثم أُعيد' });
check(
  'كتابتان في اللحظة نفسها (ردّ FORBIDDEN «is at … but expected …»): تُعاد المحاولة ويُحفظ الاثنان',
  res.status === 303 && github.count('stale') - stale === 1 && github.log.some((entry) => entry.kind === 'stale' && entry.race) && readPost(A).title === 'تعديل خسر السباق ثم أُعيد' && github.read(BOT_FILE) === `${BOT_POST}\n`,
  `${res.status}، مرفوضات: ${github.count('stale') - stale}`
);

let countBeforeRefusal = commits().length;
github.commitErrors.push([{ type: 'FORBIDDEN', message: 'Resource not accessible by personal access token' }]);
res = await save(A, { title: 'لن يُحفظ: التوكن بلا صلاحية كتابة' });
check(
  'رفض صلاحيات حقيقي (FORBIDDEN برسالة أخرى) لا يُعاد: خطأ واضح بعد محاولة واحدة، بلا كتابة',
  res.status === 502 && github.count('refused') === 1 && github.commitErrors.length === 0 && commits().length === countBeforeRefusal && readPost(A).title === 'تعديل خسر السباق ثم أُعيد',
  `الحالة ${res.status}، محاولات مرفوضة: ${github.count('refused')}`
);

const deviceOne = (await open(A)).base;
const deviceTwo = (await open(A)).base;
await save(A, { title: 'عنوان من الجهاز الأول' }, deviceOne);
res = await save(A, { labels: ['من الجهاز الثاني'] }, deviceTwo);
after = readPost(A);
check('جهازان فتحا التدوينة معاً وعدّلا حقلين مختلفين: يبقى التعديلان', res.status === 303 && after.title === 'عنوان من الجهاز الأول' && same(after.labels, ['من الجهاز الثاني']), `${after.title} / ${JSON.stringify(after.labels)}`);

count = commits().length;
for (let i = 0; i < 4; i++) github.beforeCommit.push(() => github.push({ additions: { [`${POSTS}/9998_busy.json`]: `${BOT_POST} ` }, headline: `دفعة ${i}` }));
res = await save(A, { title: 'لن يُحفظ' });
check('فرع لا يتوقف عن الحركة: تتوقف المحاولات برسالة واضحة، بلا كتابة', res.status === 502 && res.text.includes('مشغول') && commits().length === count && readPost(A).title === 'عنوان من الجهاز الأول', `الحالة ${res.status}`);
github.beforeCommit.length = 0;

// ── 6. الحذف ────────────────────────────────────────────────────────────────

section('٦. الحذف');

const victim = VICTIMS[0];
const victimTitle = readPost(victim).title;
await save(victim, { classification: { type: 'other', category: 'عام' } });
count = commits().length;

for (const word of ['', 'نعم', 'حذفف', 'delete']) {
  res = await remove(victim, word);
  check(`كلمة تأكيد خاطئة («${word}»): رُفض الحذف (422)`, res.status === 422 && commits().length === count && Boolean(github.read(fileOf(victim))), `الحالة ${res.status}`);
}

const headBefore = github.head;
res = await remove(victim);
const removedList = JSON.parse(github.read(REMOVED) ?? '{"posts":[]}').posts;
const tombstone = removedList.find((entry) => entry.slug === victim);
check('الحذف يحوّل إلى القائمة مع رقم الـcommit', res.status === 303 && /^\/studio\?deleted=[0-9a-f]{40}$/.test(res.location), `${res.status} ${res.location}`);
check('ملف التدوينة حُذف من المستودع', github.read(fileOf(victim)) === undefined);
check('مفتاحها حُذف من ملف التصنيف', !Object.hasOwn(taxonomy().posts, victim));
check('سُجّلت في قائمة المحذوفات بما يكفي لاسترجاعها', tombstone && tombstone.title === victimTitle && tombstone.file === fileOf(victim).slice(POSTS.length + 1) && tombstone.removed_from === headBefore && Math.abs(Date.now() - Date.parse(tombstone.removed_at)) < 60_000, JSON.stringify(tombstone));
check('كل ذلك في commit واحد', commits().length === count + 1 && same(lastCommit().deleted, [fileOf(victim)]) && same([...lastCommit().added].sort(), [REMOVED, TAXONOMY].sort()), JSON.stringify(lastCommit()));

const tmp = path.join(os.tmpdir(), `removed-${crypto.randomBytes(6).toString('hex')}.json`);
fs.writeFileSync(tmp, github.read(REMOVED));
check('المزامنة تعدّها موجودة فلا تعيد استيرادها من Blogger', readRemovedSlugs(tmp).has(victim));
fs.unlinkSync(tmp);

res = await request(postPath(victim));
check('صفحة التدوينة المحذوفة: «غير موجودة» (404) داخل اللوحة', res.status === 404 && res.text.includes('هذه التدوينة غير موجودة'));
check('واختفت من القائمة', !(await request('/studio')).text.includes(postPath(victim)));
res = await remove(victim);
check('حذفها مرة ثانية لا يكتب شيئاً', res.status === 404 && commits().length === count + 1);

for (const slug of VICTIMS.slice(1, 5)) await remove(slug);
check('خمس حذوفات في ساعة مسموحة', JSON.parse(github.read(REMOVED)).posts.length === 5);
count = commits().length;
res = await remove(VICTIMS[5]);
check('السادسة تُرفض بفرامل الحذف، بلا كتابة', res.status === 422 && res.text.includes('أُوقف الحذف مؤقتاً') && commits().length === count && Boolean(github.read(fileOf(VICTIMS[5]))), `الحالة ${res.status}`);

const aged = JSON.parse(github.read(REMOVED));
for (const entry of aged.posts) entry.removed_at = new Date(Date.now() - 2 * 3_600_000).toISOString();
github.push({ additions: { [REMOVED]: `${JSON.stringify(aged, null, 2)}\n` }, headline: 'مرّت ساعتان' });
res = await remove(VICTIMS[5]);
check('بعد مرور الساعة يعود الحذف', res.status === 303 && github.read(fileOf(VICTIMS[5])) === undefined, `الحالة ${res.status}`);


// ── نص التدوينة (المحرّر) ───────────────────────────────────────────────────

section('٧. حفظ نص التدوينة من المحرّر');

const { document } = new JSDOM('<!doctype html><html><body></body></html>').window;
const bodyApi = (slug) => `/api/studio/posts/${encodeURIComponent(slug)}`;
const getBody = async (slug) => JSON.parse((await request(bodyApi(slug))).text);
const putBody = async (slug, payload, options = {}) => {
  const response = await request(bodyApi(slug), { method: 'PUT', json: payload, ...options });
  let data = {};
  try {
    data = JSON.parse(response.text);
  } catch {
    // ردّ ليس JSON (404 الصفحة العامة مثلاً)
  }
  return { status: response.status, data, text: response.text };
};
/** ما يرسله المتصفح عند «حفظ»: المستند مسلسَلاً بدوال المحرّر نفسها */
const wireOf = (doc) => splitRawBlocks(bodyForSave(doc, document));

// تدوينة فيها صور وجدول، لم تمسّها الفحوص السابقة
const E = index
  .map((entry) => entry.slug)
  .find((slug) => slug !== A && !VICTIMS.includes(slug) && /<table/.test(readPost(slug).content_html) && readPost(slug).images.length >= 3);
const original = readPost(E);
const originalRaw = github.read(fileOf(E));

res = await request(`/studio/edit/${encodeURIComponent(E)}`);
check('صفحة المحرّر تفتح وفيها الشريط', res.status === 200 && res.text.includes('data-editor-toolbar') && res.text.includes('data-cmd="save"'), `الحالة ${res.status}`);
check('صفحة المحرّر لتدوينة غير موجودة: 404 داخل اللوحة', (await request('/studio/edit/no-such-post')).status === 404);

let opened3 = await getBody(E);
check('النص يُجلب طازجاً من المستودع مع بصمته', opened3.html === original.content_html && /^[0-9a-f]{64}$/.test(opened3.base) && opened3.locked === false);

let loadedDoc = loadBody(opened3.html, document).doc;
let firstImage = null;
loadedDoc.descendants((node, position) => {
  if (!firstImage && node.type.name === 'image') firstImage = { position, size: node.nodeSize, src: node.attrs.src };
});
let editedDoc = new Transform(loadedDoc).delete(firstImage.position, firstImage.position + firstImage.size).doc;
let wire = wireOf(editedDoc);

count = commits().length;
let put = await putBody(E, { ...wire, base: opened3.base });
after = readPost(E);
check('حفظ النص بعد حذف صورة: 200 مع رقم الـcommit وبصمة جديدة', put.status === 200 && /^[0-9a-f]{40}$/.test(put.data.commit ?? '') && /^[0-9a-f]{64}$/.test(put.data.base ?? '') && put.data.live === false, `${put.status} ${put.text.slice(0, 200)}`);
check('‎content_html‎ المخزَّن هو ما سلسله المحرّر، والجدول فيه كما كان حرفياً', after.content_html === expandRawBlocks(bodyForSave(editedDoc, document)) && wire.raw.every((block) => after.content_html.includes(block)) && wire.raw.length > 0);
check('‎content_text‎ أُعيد اشتقاقه من النص الجديد', after.content_text === htmlToText(after.content_html));
const lostImages = original.images.filter((image) => !after.images.some((kept) => kept.original_url === image.original_url));
check('‎images[]‎ نقصت الصورة المحذوفة وحدها، و‎image_count‎ يطابق', lostImages.length <= 1 && original.images.length - after.images.length === lostImages.length && after.image_count === after.images.length && !after.images.some((image) => image.thumbnail_url === firstImage.src), `${original.images.length} → ${after.images.length}`);
check('باقي حقول الملف لم تُمسّ، وتنسيقه محفوظ', same({ ...after, content_html: 0, content_text: 0, images: 0, image_count: 0 }, { ...original, content_html: 0, content_text: 0, images: 0, image_count: 0 }) && github.read(fileOf(E)) === JSON.stringify(after, null, 2) + (originalRaw.endsWith('\n') ? '\n' : ''));
check('commit واحد يمسّ ملف التدوينة وحده', commits().length === count + 1 && same(lastCommit().added, [fileOf(E)]) && lastCommit().headline.startsWith('لوحة التحرير: تعديل نص'), JSON.stringify(lastCommit()));

count = commits().length;
let stalePut = await putBody(E, { ...wire, base: opened3.base });
check('حفظ ببصمة قديمة (النص تغيّر منذ الفتح): 409 بلا كتابة', stalePut.status === 409 && commits().length === count, `${stalePut.status}`);
let samePut = await putBody(E, { ...wire, base: put.data.base });
check('حفظ النص نفسه مرة ثانية: لا تغيير ولا commit', samePut.status === 200 && samePut.data.unchanged === true && commits().length === count);

// جهاز آخر غيّر العنوان بعد فتح المحرّر: البصمة بصمة النص وحده، فالحفظ يمرّ والعنوان الجديد يبقى
opened3 = await getBody(E);
await save(E, { title: 'عنوان غُيّر والمحرّر مفتوح' });
loadedDoc = loadBody(opened3.html, document).doc;
let paragraph = null;
loadedDoc.forEach((node, offset) => {
  if (!paragraph && node.type.name === 'paragraph' && node.textContent.trim()) paragraph = { offset, size: node.nodeSize, text: node.textContent };
});
editedDoc = new Transform(loadedDoc).delete(paragraph.offset, paragraph.offset + paragraph.size).doc;
put = await putBody(E, { ...wireOf(editedDoc), base: opened3.base });
after = readPost(E);
check('تعديل العنوان من جهاز آخر لا يمنع حفظ النص، ولا يضيع', put.status === 200 && after.title === 'عنوان غُيّر والمحرّر مفتوح' && !after.content_text.includes(paragraph.text.trim().slice(0, 40)), `${put.status} ${after.title}`);

opened3 = await getBody(E);
stale = github.count('stale');
github.beforeCommit.push(() => github.push({ additions: { [`${POSTS}/9997_bot-again.json`]: BOT_POST }, headline: 'مزامنة آلية' }));
editedDoc = loadBody(opened3.html, document).doc;
editedDoc = new Transform(editedDoc).delete(0, editedDoc.child(0).nodeSize).doc;
put = await putBody(E, { ...wireOf(editedDoc), base: opened3.base });
check('دفعة من البوت أثناء حفظ النص: يُعاد ويُحفظ', put.status === 200 && Boolean(put.data.commit) && github.count('stale') - stale === 1, `${put.status}`);

count = commits().length;
const fresh = (await getBody(E)).base;
for (const [label, payload, status] of [
  ['سكربت في النص', { html: '<p>نص</p><script>alert(1)</script>', raw: [], base: fresh }, 422],
  ['سمة حدث', { html: '<p onclick="alert(1)">نص</p>', raw: [], base: fresh }, 422],
  ['جدول لم يكن في التدوينة', { html: '<div data-raw-block="0"></div>', raw: ['<table><tbody><tr><td>دخيل</td></tr></tbody></table>'], base: fresh }, 422],
  ['طلب بلا بصمة', { html: '<p>نص</p>', raw: [] }, 400],
  ['كتل ليست مصفوفة', { html: '<p>نص</p>', raw: 'x', base: fresh }, 400],
  ['JSON معطوب', '{"html": ', 400],
  ['طلب أكبر من الحد', { html: `<p>${'ن'.repeat(4_100_000)}</p>`, raw: [], base: fresh }, 413],
]) {
  put = await putBody(E, payload);
  check(`${label}: رُفض (${status})`, put.status === status && typeof put.data.error === 'string', `الحالة ${put.status} ${put.text.slice(0, 120)}`);
}
check('رسالة الكتلة الدخيلة تقول ما العمل', (await putBody(E, { html: '<div data-raw-block="0"></div>', raw: ['<table><tbody><tr><td>دخيل</td></tr></tbody></table>'], base: fresh })).data.error.includes('احذفه ثم احفظ'));
check('لا شيء مما رُفض وصل المستودع', commits().length === count);
check('تدوينة غير موجودة: 404', (await putBody('no-such-post', { html: '<p>x</p>', raw: [], base: fresh })).status === 404 && (await request(bodyApi('no-such-post'))).status === 404);

put = await putBody(E, { html: '<p>متسلّل</p>', raw: [], base: fresh }, { paired: false });
check('حفظ النص بلا اقتران: «غير موجود» ولا يصل المستودع', put.status === 404 && commits().length === count);
put = await putBody(E, { html: '<p>من موقع آخر</p>', raw: [], base: fresh }, { headers: { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' } });
check('حفظ النص من موقع آخر: 403 ولا يصل المستودع', put.status === 403 && commits().length === count);

// ── حالة النشر ──────────────────────────────────────────────────────────────

section('٨. حالة النشر');

const sha = github.head;
const state = async () => JSON.parse((await request(`/api/studio/status?sha=${sha}`)).text).state;
check('قبل أن يكتب Vercel شيئاً: pending', (await state()) === 'pending');
github.statuses.set(sha, [{ context: 'Vercel – blograhal', state: 'success', target_url: null }, { context: DEPLOY_CONTEXT, state: 'pending', target_url: null }]);
check('تُقرأ حالة مشروع الموقع نفسه لا المشروع الآخر', (await state()) === 'pending');
github.statuses.set(sha, [{ context: DEPLOY_CONTEXT, state: 'success', target_url: null }]);
check('نجاح البناء: success', (await state()) === 'success');
github.statuses.set(sha, [{ context: DEPLOY_CONTEXT, state: 'error', target_url: null }]);
check('فشل البناء: failure', (await state()) === 'failure');
check('sha غير صالح: 400', (await request('/api/studio/status?sha=xyz')).status === 400);
const flashed = await request(`${postPath(A)}?saved=${sha}`);
check('شريط «تم الحفظ» يظهر، وعلى فرع التجربة يقول إنه لا يُنشر', flashed.text.includes('تم الحفظ') && flashed.text.includes('فرع تجربة') && !flashed.text.includes('data-deploy-sha="'), flashed.text.slice(flashed.text.indexOf('studio-flash') - 20, flashed.text.indexOf('studio-flash') + 300));

// ── أعطال GitHub ─────────────────────────────────────────────────────────

section('٩. أعطال المستودع');

github.failures.push(500);
res = await request('/studio');
check('عطل في GitHub: رسالة واضحة (502) والصفحة لا تنهار', res.status === 502 && res.text.includes('تعذّر فتح قائمة التدوينات') && res.text.includes('أهلاً د. وائل'), `الحالة ${res.status}`);

github.failures.push(503);
res = await request('/studio');
check('عطل عابر (503) على قراءة: تُعاد مرة واحدة والقائمة تفتح', res.status === 200 && github.failures.length === 0 && (res.text.match(/data-post /g)?.length ?? 0) > 400, `الحالة ${res.status}`);

github.failures.push(503, 503);
res = await request('/studio');
check('عطل يتكرّر: إعادة واحدة لا أكثر، ثم رسالة واضحة (502)', res.status === 502 && github.failures.length === 0 && res.text.includes('تعذّر فتح قائمة التدوينات'), `الحالة ${res.status}`);

count = commits().length;
github.commitFailures.push(503);
res = await save(A, { title: 'عطل أثناء الكتابة' });
check('عطل (503) على طلب الكتابة نفسه: لا يُعاد إرساله، خطأ واضح بلا كتابة', res.status === 502 && github.count('commit-failed') === 1 && github.commitFailures.length === 0 && commits().length === count, `الحالة ${res.status}، محاولات: ${github.count('commit-failed')}`);

github.truncateOver = 2000;
res = await request('/studio');
check('ملف تصنيف يقصّه GraphQL: يُقرأ خاماً والقائمة تعمل', res.status === 200 && (res.text.match(/data-post /g)?.length ?? 0) > 400, `الحالة ${res.status}`);
github.truncateOver = Infinity;

process.env.STUDIO_GITHUB_TOKEN = 'wrong-token';
res = await request('/studio');
check('توكن مرفوض: رسالة للمطوّر بلا كشف التوكن', res.status === 502 && res.text.includes('التوكن مرفوض') && !res.text.includes('wrong-token'), `الحالة ${res.status}`);

delete process.env.STUDIO_GITHUB_TOKEN;
let asked = github.log.length;
res = await request('/studio');
check('بلا توكن: اللوحة تفتح وتقول إنها غير موصولة، ولا تتصل بشيء', res.status === 200 && res.text.includes('لم تُوصَل بالمستودع') && github.log.length === asked, `الحالة ${res.status}`);
res = await request(postPath(A));
check('بلا توكن: صفحة التدوينة تحوّل إلى الرئيسية', res.status === 303 && res.location === '/studio');
process.env.STUDIO_GITHUB_TOKEN = TOKEN;

// ── الفرع والحماية ───────────────────────────────────────────────────────

section('١٠. أي فرع يُكتب عليه، ومن يكتب');

const refs = async () => {
  const from = github.log.length;
  await request('/studio');
  return github.log.slice(from).filter((entry) => entry.kind === 'snapshot').map((entry) => entry.ref);
};
delete process.env.STUDIO_BRANCH;
check('في إنتاج Vercel بلا STUDIO_BRANCH: الفرع main', same(await refs(), ['refs/heads/main']));
delete process.env.VERCEL_ENV;
check('خارج Vercel بلا STUDIO_BRANCH: فرع التجربة، لا main', same(await refs(), [`refs/heads/${BRANCH}`]));
process.env.VERCEL_ENV = 'production';
process.env.STUDIO_BRANCH = BRANCH;

count = commits().length;
asked = github.log.length;
res = await request(postPath(A), { method: 'POST', paired: false, form: fields((await open(A)).base, { title: 'متسلّل' }) });
check('بلا اقتران: طلب التعديل «غير موجود» ولا يصل المستودع', res.status === 404 && !res.text.includes('studio-form') && commits().length === count);
res = await request(postPath(VICTIMS[6]), { method: 'POST', form: [['action', 'delete'], ['confirm', 'حذف']], headers: { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' } });
check('طلب حذف من موقع آخر: مرفوض (403) ولا يصل المستودع', res.status === 403 && commits().length === count && Boolean(github.read(fileOf(VICTIMS[6]))));

// ── تدوينة جديدة ────────────────────────────────────────────────────────────

section('١١. تدوينة جديدة');

// ملفات التجارب السابقة (9999_…) ليست مما يكتبه البوت حقاً: تُزال ليُختبر الترقيم كما في المستودع
github.push({ deletions: github.paths().filter((file) => /\/999\d_/.test(file)), headline: 'تنظيف ملفات التجربة' });

const NEW_API = '/api/studio/posts';
const prefixOf = (file) => Number(/\/(\d+)_[^/]+$/.exec(file)?.[1] ?? 0);
const topPrefix = () => Math.max(...github.paths().filter((file) => file.startsWith(`${POSTS}/`)).map(prefixOf));
const riyadhToday = new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);
const BLOB = 'https://fakestore.public.blob.vercel-storage.com/sandbox/2026/11';
const newDoc = parseBody(
  `<h2 data-align="center">يوم في كيوتو</h2><p>نص التدوينة <strong>الجديدة</strong> من اللوحة.</p>` +
    `<p><img src="${BLOB}/aaa.jpg" data-thumb="${BLOB}/aaa-thumb.jpg" alt="معبد" loading="lazy"></p>`,
  document
);
const newPost = (changes = {}) => ({
  id: 'abc123',
  title: 'يوم في كيوتو',
  date: riyadhToday,
  labels: ['رحلات', 'اليابان'],
  classification: { type: 'travel', countries: ['اليابان'] },
  ...wireOf(newDoc),
  ...changes,
});
const postNew = async (payload, options = {}) => {
  const response = await request(NEW_API, { method: 'POST', json: payload, ...options });
  let data = {};
  try {
    data = JSON.parse(response.text);
  } catch {
    // ليس JSON
  }
  return { status: response.status, data, text: response.text };
};

count = commits().length;
for (const [label, changes, field] of [
  ['بلا عنوان', { title: '   ' }, 'title'],
  ['تاريخ في المستقبل', { date: tomorrowPlus }, 'date'],
  ['نص فارغ', { html: '<p></p>', raw: [] }, 'body'],
  ['رحلة بلا دولة', { classification: { type: 'travel', countries: [] } }, 'classification'],
  ['دولة غير معروفة', { classification: { type: 'travel', countries: ['أتلانتس'] } }, 'classification'],
]) {
  const refused = await postNew(newPost(changes));
  check(`${label}: رُفض (422) والخطأ عند حقله`, refused.status === 422 && typeof refused.data.errors?.[field] === 'string', `${refused.status} ${refused.text.slice(0, 160)}`);
}
for (const [label, changes, status] of [
  ['سكربت في النص', { html: '<p>نص</p><script>alert(1)</script>', raw: [] }, 422],
  ['جدول (كتلة محفوظة) في تدوينة جديدة', { html: '<div data-raw-block="0"></div>', raw: ['<table><tbody><tr><td>x</td></tr></tbody></table>'] }, 422],
  ['معرّف غير صالح', { id: '../x' }, 400],
  ['بلا معرّف', { id: undefined }, 400],
]) {
  const refused = await postNew(newPost(changes));
  check(`${label}: رُفض (${status})`, refused.status === status, `${refused.status} ${refused.text.slice(0, 160)}`);
}
check('لا شيء مما رُفض وصل المستودع', commits().length === count);

const top = topPrefix();
const taxonomyBeforeNew = github.read(TAXONOMY);
let created = await postNew(newPost());
const newSlug = `${riyadhToday.slice(0, 7)}-rk-abc123`;
const newFile = `${POSTS}/${String(top + 1).padStart(4, '0')}_${newSlug}.json`;
check('النشر: 201 مع الـslug ورقم الـcommit، ويقول إنه ليس على الموقع', created.status === 201 && created.data.slug === newSlug && /^[0-9a-f]{40}$/.test(created.data.commit ?? '') && created.data.live === false, `${created.status} ${created.text.slice(0, 200)}`);
check('commit واحد يضيف ملف التدوينة (أعلى ترقيم + 1) ويعدّل التصنيف', commits().length === count + 1 && same([...lastCommit().added].sort(), [newFile, TAXONOMY].sort()) && lastCommit().deleted.length === 0 && lastCommit().headline.startsWith('لوحة التحرير: تدوينة جديدة'), JSON.stringify(lastCommit()));
const stored = JSON.parse(github.read(newFile) ?? '{}');
check('حقول الملف بترتيب ملفات المزامنة، و‎url‎ فارغ، و‎source: "studio"‎', same(Object.keys(stored), ['title', 'date', 'url', 'slug', 'content_html', 'content_text', 'labels', 'images', 'image_count', 'source']) && stored.url === '' && stored.slug === newSlug && stored.source === 'studio', JSON.stringify(Object.keys(stored)));
check('التاريخ يوم التدوينة بساعة الرياض الآن', new RegExp(`^${riyadhToday}T\\d{2}:\\d{2}:\\d{2}\\+03:00$`).test(stored.date) && Math.abs(Date.parse(stored.date) - Date.now()) < 120_000, stored.date);
check('النص هو ما سلسله المحرّر، والنص المشتق منه', stored.content_html === expandRawBlocks(bodyForSave(newDoc, document)) && stored.content_text === htmlToText(stored.content_html));
check('الصورة في ‎images[]‎ بنسختيها ووصفها، والغلاف أول صورة', stored.image_count === 1 && same(stored.images, [{ original_url: `${BLOB}/aaa.jpg`, thumbnail_url: `${BLOB}/aaa-thumb.jpg`, alt: 'معبد', local_path: '' }]), JSON.stringify(stored.images));
check('الوسوم كما كُتبت، والملف ينتهي بسطر جديد', same(stored.labels, ['رحلات', 'اليابان']) && github.read(newFile).endsWith('}\n'));
tax = taxonomy();
check('التصنيف: مفتاح جديد في آخر الملف، والباقي كما هو', same(tax.posts[newSlug], { continent: 'آسيا', countries: ['اليابان'], type: 'travel' }) && Object.keys(tax.posts).at(-1) === newSlug && same({ ...tax, posts: { ...tax.posts, [newSlug]: undefined } }, { ...JSON.parse(taxonomyBeforeNew), posts: { ...JSON.parse(taxonomyBeforeNew).posts, [newSlug]: undefined } }));

count = commits().length;
let again = await postNew(newPost({ title: 'ضغطة ثانية' }));
check('نشر مكرّر بالمعرّف نفسه (ضغطتان أو انقطاع): 409 مع الـslug نفسه، بلا commit', again.status === 409 && again.data.exists === true && again.data.slug === newSlug && commits().length === count, `${again.status} ${again.text.slice(0, 160)}`);
again = await postNew(newPost({ date: '2025-03-10' }));
check('…ولو تغيّر تاريخها بعد النشر الأول', again.status === 409 && again.data.slug === newSlug && commits().length === count, `${again.status}`);

res = await request('/studio');
check('القائمة تعرض التدوينة الجديدة فوراً', res.text.includes(`/studio/post/${newSlug}`) && res.text.includes('يوم في كيوتو'));
res = await request(`${postPath(newSlug)}?saved=${created.data.commit}&new=1`);
check('صفحتها في اللوحة تفتح بشريط «نُشرت التدوينة»', res.status === 200 && res.text.includes('نُشرت التدوينة') && res.text.includes('/studio/edit/'));
const newBody = await getBody(newSlug);
check('نصها يُفتح في المحرّر', newBody.html === stored.content_html && newBody.locked === false);
put = await putBody(newSlug, { ...wireOf(new Transform(loadBody(newBody.html, document).doc).insert(1, schema.text('إضافة. ')).doc), base: newBody.base });
check('وتعديل نصها يُحفظ كأي تدوينة', put.status === 200 && JSON.parse(github.read(newFile)).content_text.includes('إضافة.'), `${put.status} ${put.text.slice(0, 160)}`);

// تدوينة «موضوع آخر» بلا صور، والبوت يدفع تدوينة بين القراءة والكتابة
const raceTop = topPrefix();
const botRace = `${POSTS}/${String(raceTop + 1).padStart(4, '0')}_2026-11-bot-race.json`;
stale = github.count('stale');
github.beforeCommit.push(() => github.push({ additions: { [botRace]: BOT_POST }, headline: 'مزامنة آلية' }));
created = await postNew(newPost({ id: 'zz9988', title: 'قهوة الصباح', classification: { type: 'other', category: 'عام' }, html: '<p>نص قصير.</p>', raw: [] }));
const otherSlug = `${riyadhToday.slice(0, 7)}-rk-zz9988`;
const otherFile = `${POSTS}/${String(raceTop + 2).padStart(4, '0')}_${otherSlug}.json`;
check('البوت دفع تدوينة أثناء النشر: يُعاد ويأخذ الرقم التالي لرقمها', created.status === 201 && github.count('stale') - stale === 1 && Boolean(github.read(otherFile)) && Boolean(github.read(botRace)), `${created.status} ${created.text.slice(0, 160)}`);
check('تصنيف «موضوع آخر» بشكل المفاتيح الحالية، وبلا صور', same(taxonomy().posts[otherSlug], { continent: null, countries: [], type: 'other', category: 'عام' }) && JSON.parse(github.read(otherFile)).image_count === 0);

created = await postNew(newPost({ id: 'nn0000', title: 'بلا تصنيف', classification: { type: 'none' }, html: '<p>نص.</p>', raw: [] }));
check('«بلا تصنيف»: ملف التدوينة وحده، والتصنيف لا يُمسّ', created.status === 201 && same(lastCommit().added.filter((file) => file === TAXONOMY), []) && !Object.hasOwn(taxonomy().posts, `${riyadhToday.slice(0, 7)}-rk-nn0000`));

count = commits().length;
created = await postNew(newPost({ id: 'xx1111' }), { paired: false });
check('النشر بلا اقتران: «غير موجود» ولا يصل المستودع', created.status === 404 && commits().length === count);
created = await postNew(newPost({ id: 'xx2222' }), { headers: { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' } });
check('النشر من موقع آخر: 403 ولا يصل المستودع', created.status === 403 && commits().length === count);
res = await request('/studio/new');
check('صفحة «تدوينة جديدة» تفتح بالحقول والمحرّر وزر النشر', res.status === 200 && res.text.includes('data-new-meta') && res.text.includes('data-mode="new"') && res.text.includes('نشر التدوينة') && res.text.includes('name="country"'));
check('…وتقول إن رفع الصور غير مفعّل (لا متجر Blob بعد)', res.text.includes('data-media="off"'));

// ── رفع الصور ───────────────────────────────────────────────────────────────

section('١٢. رفع الصور إلى Blob');

const MEDIA_API = '/api/studio/media';
const multipart = async (parts) => {
  const form = new FormData();
  for (const [name, bytes, type = 'image/jpeg'] of parts) form.append(name, new Blob([bytes], { type }), `${name}.jpg`);
  const encoded = new Response(form);
  return { body: Buffer.from(await encoded.arrayBuffer()), type: encoded.headers.get('content-type') };
};
const upload = async (parts, options = {}) => {
  const response = await request(MEDIA_API, { method: 'POST', raw: await multipart(parts), ...options });
  let data = {};
  try {
    data = JSON.parse(response.text);
  } catch {
    // ليس JSON
  }
  return { status: response.status, data, text: response.text };
};
const FULL = fakeJpeg(1600, 1200, 300_000);
const THUMB = fakeJpeg(480, 360, 30_000);

let uploaded = await upload([['full', FULL], ['thumb', THUMB]]);
check('بلا متجر Blob: 503 برسالة واضحة', uploaded.status === 503 && uploaded.data.error?.includes('غير مفعّل'), `${uploaded.status}`);

const blob = await createFakeBlob();
process.env.BLOB_READ_WRITE_TOKEN = blob.token;
process.env.VERCEL_BLOB_API_URL = blob.url;
process.env.VERCEL_BLOB_RETRIES = '0';

res = await request('/studio/new');
check('مع المتجر: زر الصورة مفعّل في الصفحة', res.text.includes('data-media="on"'));

uploaded = await upload([['full', FULL], ['thumb', THUMB]]);
const month = new Date().toISOString().slice(0, 7).replace('-', '/');
const pattern = new RegExp(`^https://fakestore\\.public\\.blob\\.vercel-storage\\.com/sandbox/${month}/([\\w-]{12})\\.jpg$`);
const match = pattern.exec(uploaded.data.src ?? '');
check('صورة صالحة: 201 مع عنواني النسختين في مجلد فرع التجربة', uploaded.status === 201 && Boolean(match) && uploaded.data.thumb === uploaded.data.src.replace(/\.jpg$/, '-thumb.jpg'), `${uploaded.status} ${uploaded.text.slice(0, 200)}`);
const storedFull = match && blob.uploads.get(`sandbox/${month}/${match[1]}.jpg`);
const storedThumb = match && blob.uploads.get(`sandbox/${month}/${match[1]}-thumb.jpg`);
check('النسختان كُتبتا كما أُرسلتا', Boolean(storedFull) && storedFull.bytes.equals(FULL) && Boolean(storedThumb) && storedThumb.bytes.equals(THUMB));
check('عامّتان، JPEG، بلا لاحقة عشوائية، وتخزين سنة', Boolean(storedFull) && storedFull.headers['x-vercel-blob-access'] === 'public' && storedFull.headers['x-content-type'] === 'image/jpeg' && storedFull.headers['x-add-random-suffix'] === '0' && storedFull.headers['x-cache-control-max-age'] === String(365 * 24 * 3600), JSON.stringify(storedFull?.headers ?? {}));

const uploadsBefore = blob.uploads.size;
for (const [label, parts, status, code] of [
  ['ملف PNG', [['full', Buffer.from('\x89PNG\r\n\x1a\n' + 'x'.repeat(500), 'binary')], ['thumb', THUMB]], 422, 'not-jpeg'],
  ['نسخة كبيرة أعرض من 2400px', [['full', fakeJpeg(3000, 2000)], ['thumb', THUMB]], 422, 'too-wide'],
  ['مصغّرة أعرض من 640px', [['full', FULL], ['thumb', fakeJpeg(1000, 800)]], 422, 'too-wide'],
  ['نسخة كبيرة أثقل من 3.8MB', [['full', fakeJpeg(2000, 1500, 3_900_000)], ['thumb', THUMB]], 422, 'too-heavy'],
  ['بلا مصغّرة', [['full', FULL]], 400, undefined],
]) {
  const refused = await upload(parts);
  check(`${label}: رُفض (${status})`, refused.status === status && (code === undefined || refused.data.code === code), `${refused.status} ${refused.text.slice(0, 120)}`);
}
check('لا شيء مما رُفض كُتب في Blob', blob.uploads.size === uploadsBefore);

blob.failures.push(403);
uploaded = await upload([['full', FULL], ['thumb', THUMB]]);
check('Blob رفض الكتابة: 502 برسالة للمستخدم', uploaded.status === 502 && typeof uploaded.data.error === 'string', `${uploaded.status} ${uploaded.text.slice(0, 120)}`);

// النسختان تُكتبان معاً؛ إن رُفضت واحدة قد تبقى الأخرى في Blob بلا مرجع (كأي صورة لم تُحفظ تدوينتها)
const uploadsAfterFailure = blob.uploads.size;

uploaded = await upload([['full', FULL], ['thumb', THUMB]], { paired: false });
check('الرفع بلا اقتران: «غير موجود» ولا يُكتب شيء', uploaded.status === 404 && blob.uploads.size === uploadsAfterFailure);
uploaded = await upload([['full', FULL], ['thumb', THUMB]], { headers: { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' } });
check('الرفع من موقع آخر: 403 ولا يُكتب شيء', uploaded.status === 403 && blob.uploads.size === uploadsAfterFailure);

process.env.STUDIO_BRANCH = 'main';
uploaded = await upload([['full', FULL], ['thumb', THUMB]]);
check('على الموقع الحيّ (main) تُكتب الصور في مجلد posts/', uploaded.status === 201 && uploaded.data.src?.includes('.vercel-storage.com/posts/'), uploaded.data.src);
process.env.STUDIO_BRANCH = BRANCH;

check('رمز Blob لم يظهر في أي ردّ من اللوحة', !everything.some((piece) => piece.includes(blob.token)));
delete process.env.BLOB_READ_WRITE_TOKEN;
delete process.env.VERCEL_BLOB_API_URL;
await blob.close();

check('التوكن لم يظهر في أي ردّ من اللوحة', !everything.some((piece) => piece.includes(TOKEN)));
check('كل كتابة مرّت بـcommit من اللوحة (لا كتابة خارج createCommitOnBranch)', commits().every((entry) => entry.headline.startsWith('لوحة التحرير: ')));

await output.close();
await github.close();

console.log(`\nعمليات كتابة وصلت المستودع الوهمي: ${commits().length} · كتابات رُفضت لتحرّك الفرع: ${github.count('stale')}`);
console.log(failures === 0 ? `\n✅ البوابة ناجحة: ${total} فحصاً.` : `\n⛔ البوابة فاشلة: ${failures} من ${total} فحصاً.`);
process.exit(failures === 0 ? 0 : 1);
