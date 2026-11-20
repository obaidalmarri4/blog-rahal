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
import { createFakeGitHub } from './lib/fake-github.mjs';
import { readRemovedSlugs } from './lib/removed-posts.mjs';
import { createOutputServer } from './lib/vercel-output-server.mjs';
import { buildStudioIndex } from '../src/lib/studio/index-plugin.mjs';
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

function request(pathname, { method = 'GET', form, paired = true, headers = {} } = {}) {
  const body = form ? new URLSearchParams(form).toString() : undefined;
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
          ...(method === 'POST'
            ? {
                origin: ORIGIN,
                'sec-fetch-site': 'same-origin',
                'content-type': 'application/x-www-form-urlencoded',
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

// ── 7. حالة النشر ───────────────────────────────────────────────────────────

section('٧. حالة النشر');

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

// ── 8. أعطال GitHub ─────────────────────────────────────────────────────────

section('٨. أعطال المستودع');

github.failures.push(500);
res = await request('/studio');
check('عطل في GitHub: رسالة واضحة (502) والصفحة لا تنهار', res.status === 502 && res.text.includes('تعذّر فتح قائمة التدوينات') && res.text.includes('أهلاً د. وائل'), `الحالة ${res.status}`);

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

// ── 9. الفرع والحماية ───────────────────────────────────────────────────────

section('٩. أي فرع يُكتب عليه، ومن يكتب');

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

check('التوكن لم يظهر في أي ردّ من اللوحة', !everything.some((piece) => piece.includes(TOKEN)));
check('كل كتابة مرّت بـcommit من اللوحة (لا كتابة خارج createCommitOnBranch)', commits().every((entry) => entry.headline.startsWith('لوحة التحرير: ')));

await output.close();
await github.close();

console.log(`\nعمليات كتابة وصلت المستودع الوهمي: ${commits().length} · كتابات رُفضت لتحرّك الفرع: ${github.count('stale')}`);
console.log(failures === 0 ? `\n✅ البوابة ناجحة: ${total} فحصاً.` : `\n⛔ البوابة فاشلة: ${failures} من ${total} فحصاً.`);
process.exit(failures === 0 ? 0 : 1);
