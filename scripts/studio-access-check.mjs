#!/usr/bin/env node
/**
 * بوابة الوصول إلى لوحة التحرير (/studio).
 *
 * يشغّل الحزمة التي تُنشر فعلاً (‎.vercel/output‎) محلياً ويتحقق من قاعدة واحدة من كل
 * الجهات: **لا يفتح اللوحة إلا من يحمل اقتراناً صالحاً، ومن عداه يرى صفحة «غير موجودة»
 * نفسها التي يراها زائر أي عنوان خاطئ.**
 *
 * الاستعمال (يحتاج بناءً حديثاً، و Node 22.18 فما فوق لاستيراد session.ts مباشرة):
 *
 *   npm run build && node scripts/studio-access-check.mjs
 *
 * شغّله بعد أي تغيير في src/middleware.ts أو src/lib/studio/{session,access,guard}.ts أو
 * صفحات ‎/studio‎ و ‎/api/studio‎ أو إعداد المحوّل. يخرج برمز 1 عند أي فحص فاشل.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createOutputServer } from './lib/vercel-output-server.mjs';
import { COOKIE_NAME, SESSION_SECONDS, issueSession } from '../src/lib/studio/session.ts';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT_DIR = path.join(ROOT, '.vercel/output');

/** يجب أن يطابق security.allowedDomains في astro.config.mjs */
const PRODUCTION_HOST = 'blog-rahal.vercel.app';
const ORIGIN = `https://${PRODUCTION_HOST}`;
const FORCE_FUNCTION = 'x-check-force-function';
const DAY_MS = 24 * 60 * 60 * 1000;
const GREETING = 'أهلاً د. وائل';

if (!fs.existsSync(path.join(OUTPUT_DIR, 'config.json'))) {
  console.error('لا يوجد ناتج بناء (.vercel/output) — شغّل npm run build أولاً.');
  process.exit(1);
}

const newKey = () => crypto.randomBytes(32).toString('base64url');
const KEY = newKey();

// البيئة قبل تحميل الدالة: كما هي على Vercel في الإنتاج
process.env.STUDIO_KEY = KEY;
process.env.VERCEL_ENV = 'production';
// بلا توكن GitHub: هذه البوابة تختبر الباب وحده، ولا يجوز أن تصل إلى أي مستودع
for (const name of ['STUDIO_GITHUB_TOKEN', 'STUDIO_GITHUB_API', 'STUDIO_BRANCH', 'STUDIO_REPO']) delete process.env[name];

const output = await createOutputServer(OUTPUT_DIR, { forceFunctionHeader: FORCE_FUNCTION });
const port = await output.listen();

function request(pathname, { method = 'GET', cookie, headers = {}, host = PRODUCTION_HOST, force = false, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: pathname,
        method,
        headers: {
          host,
          'x-forwarded-proto': 'https',
          ...(cookie ? { cookie: `${COOKIE_NAME}=${cookie}` } : {}),
          ...(force ? { [FORCE_FUNCTION]: '1' } : {}),
          ...headers,
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const body = Buffer.concat(chunks);
          const setCookie = (res.headers['set-cookie'] || []).find((c) => c.startsWith(`${COOKIE_NAME}=`));
          resolve({ status: res.statusCode, headers: res.headers, body, text: body.toString('utf-8'), setCookie });
        });
      }
    );
    req.on('error', reject);
    req.end(body);
  });
}

/** طلب كتابة كما يرسله نموذج في صفحة من الموقع نفسه */
const formPost = (pathname, options = {}) =>
  request(pathname, {
    method: 'POST',
    ...options,
    headers: {
      origin: ORIGIN,
      'sec-fetch-site': 'same-origin',
      'content-type': 'application/x-www-form-urlencoded',
      'content-length': '0',
      ...options.headers,
    },
  });

// ── أدوات التقرير ───────────────────────────────────────────────────────────

let failures = 0;
let total = 0;

function section(title) {
  console.log(`\n${title}`);
}

function check(label, ok, detail = '') {
  total++;
  if (!ok) failures++;
  console.log(`  ${ok ? '✓' : '✗'} ${label}${!ok && detail ? `\n      ${detail}` : ''}`);
}

const NOT_FOUND_PAGE = fs.readFileSync(path.join(output.staticDir, '404.html'));

/** «غير موجودة» كما يراها زائر أي عنوان خاطئ: 404، الصفحة نفسها حرفياً، ولا كوكي */
function looksNotFound(res) {
  return res.status === 404 && res.body.equals(NOT_FOUND_PAGE) && !res.setCookie;
}

const describe = (res) =>
  `الحالة ${res.status}، الجسم ${res.body.length} بايت (صفحة 404: ${NOT_FOUND_PAGE.length})${res.setCookie ? '، مع كوكي' : ''}`;

const cookieValue = (res) => res.setCookie?.split(';')[0].slice(COOKIE_NAME.length + 1);

/** اللوحة لم تُفتح: لا 200 ولا تحية ولا كوكي */
const stayedClosed = (res) => res.status !== 200 && !res.text.includes(GREETING) && !res.setCookie;

// ── 1. بلا اقتران ───────────────────────────────────────────────────────────

section('١. بلا اقتران: كل شيء «غير موجود»');

const anyMissingPage = await request('/no-such-page');
check('عنوان خاطئ عادي يعيد صفحة 404 الساكنة', looksNotFound(anyMissingPage), describe(anyMissingPage));

for (const pathname of ['/studio', '/studio/', '/studio/new', '/studio/not-found', '/studio/post/2025-12-blog-post', '/studio/edit/2025-12-blog-post', '/api/studio/posts/2025-12-blog-post', `/api/studio/status?sha=${'a'.repeat(40)}`, '/api/studio/whatever']) {
  const res = await request(pathname);
  check(`${pathname} يطابق صفحة 404 حرفياً`, looksNotFound(res), describe(res));
}

const wrongKey = await request(`/studio/enter/${newKey()}`);
check('رابط اقتران بمفتاح خاطئ يطابق صفحة 404 حرفياً', looksNotFound(wrongKey), describe(wrongKey));

for (const [label, candidate] of [
  ['بمفتاح ناقص حرفاً', KEY.slice(0, -1)],
  ['بمفتاح زائد حرفاً', `${KEY}x`],
  ['بمفتاح تغيّرت حالة أحرفه', KEY === KEY.toLowerCase() ? KEY.toUpperCase() : KEY.toLowerCase()],
]) {
  const res = await request(`/studio/enter/${candidate}`);
  check(`رابط اقتران ${label} مرفوض`, looksNotFound(res), describe(res));
}

for (const pathname of ['/api/studio/unpair', '/studio/post/2025-12-blog-post', '/api/studio/posts', '/api/studio/media']) {
  const res = await formPost(pathname);
  check(`POST ${pathname} بلا كوكي يطابق صفحة 404 حرفياً`, looksNotFound(res), describe(res));
}
const putUnpaired = await request('/api/studio/posts/2025-12-blog-post', {
  method: 'PUT',
  body: '{}',
  headers: { origin: ORIGIN, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', 'content-length': '2' },
});
check('PUT ‎/api/studio/posts/…‎ بلا كوكي يطابق صفحة 404 حرفياً', looksNotFound(putUnpaired), describe(putUnpaired));

// ما يرسله أي أداة فحص (curl مثلاً): طلب كتابة بلا Origin أو من موقع آخر. فحص Astro المدمج كان يردّ
// عليه 403 قبل الوسيط، وعنوان غير موجود يردّ 404 — فيظهر أن ‎/studio‎ موجودة.
for (const [method, pathname, headers] of [
  ['POST', '/studio', {}],
  ['POST', '/api/studio/unpair', { 'content-type': 'application/x-www-form-urlencoded', 'content-length': '0' }],
  ['POST', '/studio/post/2025-12-blog-post', { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site', 'content-type': 'multipart/form-data; boundary=x', 'content-length': '0' }],
  ['PUT', '/api/studio/posts/2025-12-blog-post', { 'content-type': 'text/plain', 'content-length': '0' }],
  ['DELETE', '/studio', {}],
  ['POST', '/api/studio/posts', { 'content-type': 'application/json', 'content-length': '0' }],
  ['POST', '/api/studio/media', { 'content-type': 'multipart/form-data; boundary=x', 'content-length': '0' }],
]) {
  const res = await request(pathname, { method, headers });
  check(`${method} ${pathname} بلا Origin مطابق ولا كوكي يطابق صفحة 404 حرفياً`, looksNotFound(res), describe(res));
}

check(
  'ردّ اللوحة المغلقة يحمل Cache-Control الملفات الساكنة نفسه',
  (await request('/studio')).headers['cache-control'] === anyMissingPage.headers['cache-control'],
  `اللوحة: ${(await request('/studio')).headers['cache-control']} — الساكنة: ${anyMissingPage.headers['cache-control']}`
);

// ── 2. الاقتران ─────────────────────────────────────────────────────────────

section('٢. الاقتران بالرابط السرّي');

const enter = await request(`/studio/enter/${KEY}`);
const cookie = cookieValue(enter);
check('الرابط الصحيح يحوّل (303) إلى ‎/studio‎ بلا مفتاح في العنوان', enter.status === 303 && enter.headers.location === '/studio', `الحالة ${enter.status}، Location: ${enter.headers.location}`);
check('ردّ الاقتران لا يحمل المفتاح في أي مكان', !JSON.stringify(enter.headers).includes(KEY) && !enter.text.includes(KEY));

const attributes = (enter.setCookie || '').toLowerCase().split(';').map((part) => part.trim());
for (const attribute of ['httponly', 'secure', 'samesite=lax', 'path=/', `max-age=${SESSION_SECONDS}`]) {
  check(`الكوكي تحمل ${attribute}`, attributes.includes(attribute), enter.setCookie || 'لا كوكي');
}

// Referrer-Policy يجب أن تبقى same-origin: مع no-referrer يرسل المتصفح ‎Origin: null‎ في نماذج
// اللوحة نفسها فترفضها (403). هذا السكربت لا يحاكي المتصفح، فيثبّت القيمة بدل ذلك.
const SEALS = { 'x-robots-tag': 'noindex, nofollow', 'cache-control': 'no-store', 'referrer-policy': 'same-origin' };
const isSealed = (res) => Object.entries(SEALS).every(([name, value]) => res.headers[name] === value);
check('ردّ الاقتران: noindex و no-store و Referrer-Policy: same-origin', isSealed(enter), JSON.stringify(enter.headers));

const opened = await request('/studio', { cookie });
check('الجهاز المقترن يفتح ‎/studio‎ (200) ويرى التحية', opened.status === 200 && opened.text.includes(GREETING), describe(opened));
check('صفحة اللوحة: noindex و no-store و Referrer-Policy: same-origin', isSealed(opened), JSON.stringify(opened.headers));
check('كوكي حديثة لا تُعاد كتابتها مع كل طلب', !opened.setCookie);

// ── 3. كوكي غير صالحة ───────────────────────────────────────────────────────

section('٣. كوكي مزوّرة أو منتهية');

const [version, expires, signature] = cookie.split('.');
const flipped = signature.slice(0, -2) + (signature.endsWith('AA') ? 'BB' : 'AA');
for (const [label, forged] of [
  ['بتوقيع معدَّل', `${version}.${expires}.${flipped}`],
  ['بتاريخ انتهاء ممدَّد وتوقيعها القديم', `${version}.${Number(expires) + 86400}.${signature}`],
  ['بلا توقيع', `${version}.${expires}.`],
  ['موقّعة بمفتاح آخر', issueSession(newKey())],
  ['منتهية (صدرت قبل سنة ويوم)', issueSession(KEY, Date.now() - SESSION_SECONDS * 1000 - DAY_MS)],
  ['فارغة', ''],
]) {
  const res = await request('/studio', { cookie: forged });
  check(`كوكي ${label} مرفوضة`, looksNotFound(res), describe(res));
}

const aging = await request('/studio', { cookie: issueSession(KEY, Date.now() - 40 * DAY_MS) });
check('كوكي عمرها 40 يوماً تفتح اللوحة وتُجدَّد لسنة جديدة', aging.status === 200 && Boolean(cookieValue(aging)), describe(aging));

// ── 4. طلبات الكتابة و CSRF ──────────────────────────────────────────────────

section('٤. طلبات الكتابة من خارج الموقع');

for (const [label, headers] of [
  ['من موقع آخر (Origin مختلف)', { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' }],
  ['Origin صحيح لكن Sec-Fetch-Site يقول cross-site', { 'sec-fetch-site': 'cross-site' }],
  ['من نطاق شقيق (same-site)', { origin: 'https://other.vercel.app', 'sec-fetch-site': 'same-site' }],
  ['بلا Origin', { origin: undefined, 'sec-fetch-site': undefined }],
  ['بـ‎Origin: null‎ (ما يرسله المتصفح من صفحة سياستها no-referrer)', { origin: 'null', 'sec-fetch-site': 'same-origin' }],
]) {
  const cleaned = Object.fromEntries(Object.entries(headers).filter(([, value]) => value !== undefined));
  const res = await request('/api/studio/unpair', {
    method: 'POST',
    cookie,
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'content-length': '0', ...cleaned },
  });
  check(`POST ${label} مرفوض (403) ولا يمسّ الكوكي`, res.status === 403 && !res.setCookie, describe(res));
}

// المحوّل يقبل استبدال مسار الطلب من ‎?x_astro_path=‎ ويلصقه بعد اسم النطاق بلا فاصل، فيمكن
// جعل Astro يظن أن النطاق نطاق المهاجم — وعندها يطابق Origin المهاجم «نطاق الموقع».
for (const injected of ['.evil.example', '@evil.example', ':8443']) {
  const res = await request(`/api/studio/unpair?x_astro_path=${encodeURIComponent(`${injected}/api/studio/unpair`)}`, {
    method: 'POST',
    cookie,
    headers: {
      origin: `https://${injected.startsWith('.') ? PRODUCTION_HOST : ''}${injected.replace('@', '')}`,
      'content-type': 'application/x-www-form-urlencoded',
      'content-length': '0',
    },
  });
  check(`حيلة تبديل النطاق (x_astro_path=${injected}/…) لا تمرّر طلب كتابة`, res.status !== 303 && !res.setCookie, describe(res));
}

const getUnpair = await request('/api/studio/unpair', { cookie });
check('GET ‎/api/studio/unpair‎ لا يلغي الاقتران', getUnpair.status === 404 && !getUnpair.setCookie, describe(getUnpair));

const unpair = await formPost('/api/studio/unpair', { cookie });
const cleared = /max-age=0|expires=thu, 01 jan 1970/i.test(unpair.setCookie || '') && cookieValue(unpair) !== cookie;
check('POST من الموقع نفسه يلغي الاقتران ويحوّل إلى الرئيسية', unpair.status === 303 && unpair.headers.location === '/' && cleared, `${describe(unpair)} — ${unpair.setCookie}`);

// ── 5. المفتاح والبيئة والنطاق ──────────────────────────────────────────────

section('٥. تغيير المفتاح، بيئة المعاينة، ونطاق غير موثوق');

// لو أرسل Vercel النطاق العام في X-Forwarded-Host وترك Host لعنوان داخلي، يجب ألا تنغلق اللوحة
const viaProxy = await request(`/studio/enter/${KEY}`, { host: 'internal.invalid', headers: { 'x-forwarded-host': PRODUCTION_HOST } });
check('النطاق الموثوق في X-Forwarded-Host يكفي (Host داخلي)', viaProxy.status === 303 && Boolean(cookieValue(viaProxy)), describe(viaProxy));
const spoofedForward = await request('/studio', { cookie, headers: { 'x-forwarded-host': 'evil.example' } });
check('X-Forwarded-Host لنطاق غير موثوق يغلق اللوحة', looksNotFound(spoofedForward), describe(spoofedForward));

const otherHost = 'blog-rahal-abc123-team.vercel.app';
check('نطاق خارج allowedDomains: الكوكي الصالحة لا تفتح اللوحة', looksNotFound(await request('/studio', { cookie, host: otherHost })));
check('نطاق خارج allowedDomains: الرابط الصحيح لا يقرن', looksNotFound(await request(`/studio/enter/${KEY}`, { host: otherHost })));

process.env.VERCEL_ENV = 'preview';
check('في بيئة Preview: الكوكي الصالحة لا تفتح اللوحة', looksNotFound(await request('/studio', { cookie })));
check('في بيئة Preview: الرابط الصحيح لا يقرن', looksNotFound(await request(`/studio/enter/${KEY}`)));
process.env.VERCEL_ENV = 'production';

const ROTATED = newKey();
process.env.STUDIO_KEY = ROTATED;
check('بعد تغيير STUDIO_KEY: الجهاز المقترن يُطرد', looksNotFound(await request('/studio', { cookie })));
check('بعد تغيير STUDIO_KEY: الرابط القديم يموت', looksNotFound(await request(`/studio/enter/${KEY}`)));
const reEnter = await request(`/studio/enter/${ROTATED}`);
check('بعد تغيير STUDIO_KEY: الرابط الجديد يقرن', reEnter.status === 303 && Boolean(cookieValue(reEnter)), describe(reEnter));

for (const [label, value, candidate] of [
  ['غير مضبوط', undefined, 'undefined'],
  ['فارغ', '', ''],
  ['قصير (abc)', 'abc', 'abc'],
  ['فيه رموز خارج العناوين', `${'a'.repeat(40)}/..`, encodeURIComponent(`${'a'.repeat(40)}/..`)],
]) {
  if (value === undefined) delete process.env.STUDIO_KEY;
  else process.env.STUDIO_KEY = value;
  const viaLink = await request(`/studio/enter/${candidate}`);
  const viaCookie = await request('/studio', { cookie: cookieValue(reEnter) });
  check(`STUDIO_KEY ${label}: اللوحة مغلقة تماماً`, stayedClosed(viaLink) && viaLink.status === 404 && looksNotFound(viaCookie), `الرابط: ${describe(viaLink)} — الكوكي: ${describe(viaCookie)}`);
}

// قيمة لُصقت في لوحة Vercel ومعها سطر جديد أو مسافة: المفتاح هو ما بينهما
process.env.STUDIO_KEY = ` ${KEY}\n`;
const pasted = await request(`/studio/enter/${KEY}`);
check('STUDIO_KEY ملصوق بمسافة وسطر جديد حوله: الرابط يقرن', pasted.status === 303 && Boolean(cookieValue(pasted)), describe(pasted));
check('…والكوكي التي أصدرها تفتح اللوحة', (await request('/studio', { cookie: cookieValue(pasted) })).status === 200);
check('…والرابط بالمسافة نفسها لا يقرن', looksNotFound(await request(`/studio/enter/${encodeURIComponent(` ${KEY}`)}`)));
process.env.STUDIO_KEY = KEY;

// ── 6. عناوين ملتوية تصل إلى الدالة مباشرة ──────────────────────────────────

section('٦. عناوين ملتوية (تُرسَل إلى دالة الخادم مباشرة، بلا اقتران)');

for (const pathname of [
  '/%73tudio',
  '/%2573tudio',
  '/studio%2f',
  '//studio',
  '/studio//',
  '/studio/.',
  '/./studio',
  '/STUDIO',
  '/studio;x',
  '/studio/not-found?x_astro_path=/studio',
  '/studio/not-found?x_astro_path=/studio/post/2025-12-blog-post',
  '/studio/not-found?x_astro_path=/studio/edit/2025-12-blog-post',
  '/studio/not-found?x_astro_path=/api/studio/posts/2025-12-blog-post',
  '/studio/post/%2e%2e',
  `/studio/not-found?x_astro_path=${encodeURIComponent('@evil.example/studio')}`,
  '/_image?href=%2Ffavicon.svg&w=16&h=16&f=png',
  '/_server-islands/Anything',
]) {
  const res = await request(pathname, { force: true });
  check(`${pathname} لا يفتح شيئاً (${res.status})`, stayedClosed(res), describe(res));
}

const pathHeader = await request('/studio/not-found', { force: true, headers: { 'x-astro-path': '/studio' } });
check('ترويسة x-astro-path: ‎/studio‎ لا تفتح اللوحة', stayedClosed(pathHeader), describe(pathHeader));

// ── 7. الصفحات العامة ما زالت ساكنة ─────────────────────────────────────────

section('٧. الصفحات العامة ما زالت ملفات ساكنة');

const onDemand = output.routes.filter((route) => !route.dest.startsWith('/')).map((route) => route.src);
const EXPECTED_ON_DEMAND = [
  '^/_image/?$',
  '^/_server-islands/([^/]+?)/?$',
  '^/api/studio/media/?$',
  '^/api/studio/posts/([^/]+?)/?$',
  '^/api/studio/posts/?$',
  '^/api/studio/status/?$',
  '^/api/studio/unpair/?$',
  '^/studio/?$',
  '^/studio/edit/([^/]+?)/?$',
  '^/studio/enter/([^/]+?)/?$',
  '^/studio/new/?$',
  '^/studio/not-found/?$',
  '^/studio/post/([^/]+?)/?$',
];
check(
  'ما يذهب إلى الخادم هو مسارات اللوحة فقط (ومعها نقطتا Astro الداخليتان المغلقتان)',
  JSON.stringify([...onDemand].sort()) === JSON.stringify(EXPECTED_ON_DEMAND),
  `الموجود: ${JSON.stringify(onDemand)}`
);

const before = output.stats.function;
for (const pathname of ['/', '/blog/', '/about/', '/album/', '/atlas/', '/destinations/', '/favicon.svg']) {
  const res = await request(pathname);
  check(`${pathname} ملف ساكن (200)`, res.status === 200 && output.stats.function === before, describe(res));
}

const countHtml = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).reduce((n, entry) => n + (entry.isDirectory() ? countHtml(path.join(dir, entry.name)) : Number(entry.name.endsWith('.html'))), 0);
check('لا ملف ساكن تحت ‎/studio‎ أو ‎/api‎', !fs.existsSync(path.join(output.staticDir, 'studio')) && !fs.existsSync(path.join(output.staticDir, 'api')));

// مفتاح التطوير المحلي لا يجوز أن يُخبز داخل ما يُنشر
const envLocal = path.join(ROOT, '.env.local');
const devKey = fs.existsSync(envLocal) ? /^STUDIO_KEY=["']?([^"'\s]+)/m.exec(fs.readFileSync(envLocal, 'utf-8'))?.[1] : null;
if (devKey) {
  const leaks = [];
  const scan = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules' && entry.name !== 'media') scan(file);
      } else if (/\.(m?js|json|html|css)$/.test(entry.name) && fs.readFileSync(file).includes(devKey)) {
        leaks.push(path.relative(OUTPUT_DIR, file));
      }
    }
  };
  scan(OUTPUT_DIR);
  check('مفتاح ‎.env.local‎ غير موجود داخل ناتج البناء', leaks.length === 0, leaks.join('، '));
}

await output.close();

console.log(`\nالصفحات الساكنة: ${countHtml(output.staticDir)} · طلبات وصلت دالة الخادم: ${output.stats.function}`);
console.log(
  failures === 0
    ? `\n✅ البوابة ناجحة: ${total} فحصاً، اللوحة لا تُفتح إلا باقتران صالح.`
    : `\n⛔ البوابة فاشلة: ${failures} من ${total} فحصاً.`
);
process.exit(failures === 0 ? 0 : 1);
