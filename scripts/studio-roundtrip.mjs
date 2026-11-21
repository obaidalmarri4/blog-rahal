#!/usr/bin/env node
/**
 * بوابة جودة محرّر لوحة التحرير (/studio).
 *
 * يمرّر كل تدوينة: HTML → مخطط المحرّر → HTML، ويتحقق أن شيئاً من المحتوى لم يسقط:
 * النص، الصور وترتيبها، الروابط، المقاطع المضمّنة (يوتيوب/فيديو)، والجداول. هذا ما يحدث
 * فعلاً حين يفتح الرحّال تدوينة قديمة ويضغط «حفظ».
 *
 * الاستعمال:
 *   node scripts/studio-roundtrip.mjs                  تقرير مختصر
 *   node scripts/studio-roundtrip.mjs --verbose        مع موضع أول اختلاف في كل تدوينة فاشلة
 *   node scripts/studio-roundtrip.mjs --only <slug>    تدوينة واحدة
 *   node scripts/studio-roundtrip.mjs --json <path>    حفظ التقرير كاملاً
 *
 * يخرج برمز 1 إن فُقد نص من أي تدوينة أو نزلت نسبة التطابق الكامل عن 97%.
 *
 * التحليل بـjsdom (محلّل HTML مطابق للمواصفة) ليطابق ما يبنيه المتصفح الحقيقي.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { parseBody, serializeBody } from '../src/lib/studio/document.js';
import { RAW_BLOCK_TAGS, expandRawBlocks } from '../src/lib/studio/raw-blocks.js';
import { cleanSlug } from './lib/post-html.mjs';

const POSTS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/content/posts');
const PASS_RATE_REQUIRED = 0.97;

const args = process.argv.slice(2);
const VERBOSE = args.includes('--verbose');
const valueOf = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : null);
const ONLY = valueOf('--only');
const JSON_OUT = valueOf('--json');

/**
 * نافذة jsdom واحدة لكل التشغيل، والتحليل داخل عنصر ‎<body>‎ منفصل يُترك لجامع القمامة.
 * (نافذة جديدة لكل تدوينة تترك نحو 2MB لا تتحرّر حتى بعد close()، فتمتلئ الذاكرة قبل
 * نهاية الأرشيف.) سياق ‎<body>‎ هو نفس ما يبني به المتصفح شجرة المحرّر.
 */
const { document } = new JSDOM('<!doctype html><html><body></body></html>').window;

function toBody(html) {
  const body = document.createElement('body');
  body.innerHTML = html;
  return body;
}

/** مرور واحد: HTML → مستند المحرّر → HTML (بالدوال نفسها التي يستعملها المتصفح) */
function editorPass(html) {
  const doc = parseBody(html, document);
  return { html: expandRawBlocks(serializeBody(doc, document)), doc };
}

/**
 * الشكل القانوني = مروران. المرور الأول يُبقي أحياناً مسافة في أول الفقرة (كانت في الأصل
 * بعد وسم سطري) يحذفها المرور الثاني، ثم يثبت الناتج. المحرّر يحمّل التدوينة بنفس
 * الطريقة حتى لا يُنتج «حفظ بلا تعديل» فرقاً في Git.
 */
function roundTrip(html) {
  const once = editorPass(html);
  const twice = editorPass(once.html);
  return { ...twice, settledOnFirstPass: once.html === twice.html };
}

// ── استخلاص ما يجب أن يبقى ──────────────────────────────────────────────────

const collapse = (list) => list.filter((v, i) => i === 0 || v !== list[i - 1]);

function fingerprint(html) {
  const body = toBody(html);
  // ما يتجاهله المتصفح والمحرّر معاً: لا يُعدّ فقدانه خسارة
  body.querySelectorAll('script, style, noscript, title').forEach((el) => el.remove());
  const rawTags = RAW_BLOCK_TAGS.join(',');
  return {
    // كل ما ليس مسافة — الفواصل بين الكتل تتغيّر شكلاً (div → p) ولا تهمّ
    text: body.textContent.replace(/\s+/g, ''),
    images: [...body.querySelectorAll('img')]
      .map((el) => el.getAttribute('src') || '')
      .filter((src) => src && !src.startsWith('data:')),
    // روابط لها محتوى ظاهر؛ المتتالي المتطابق يُدمج لأن المحرّر يوحّد الروابط المتجاورة
    links: collapse(
      [...body.querySelectorAll('a[href]')]
        .filter((el) => !el.closest(rawTags))
        .filter((el) => el.textContent.trim() !== '' || el.querySelector('img'))
        .map((el) => el.getAttribute('href').trim())
        // ‎<a href="">‎ ليس رابطاً — المحرّر يسقط الوسم ويبقي نصّه
        .filter(Boolean)
    ),
    embeds: [...body.querySelectorAll('iframe, video, audio, source, embed, object')].map(
      (el) => `${el.tagName.toLowerCase()}:${el.getAttribute('src') || el.getAttribute('data') || ''}`
    ),
    tables: body.querySelectorAll('table').length,
  };
}

function firstDiff(a, b) {
  if (typeof a === 'string') {
    let i = 0;
    while (i < a.length && a[i] === b[i]) i++;
    return { at: i, before: a.slice(Math.max(0, i - 30), i + 50), after: b.slice(Math.max(0, i - 30), i + 50) };
  }
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  return { at: i, before: a.slice(i, i + 2), after: b.slice(i, i + 2), counts: [a.length, b.length] };
}

const same = (a, b) => (typeof a === 'string' || typeof a === 'number' ? a === b : a.length === b.length && a.every((v, i) => v === b[i]));

// ── التنفيذ ─────────────────────────────────────────────────────────────────

const CHECKS = ['text', 'images', 'links', 'embeds', 'tables'];
const LABELS = { text: 'النص', images: 'الصور', links: 'الروابط', embeds: 'المقاطع', tables: 'الجداول', stable: 'الثبات' };

const results = [];
const rawStats = {};
let postsWithRaw = 0;

for (const file of fs.readdirSync(POSTS_DIR).sort()) {
  if (!file.endsWith('.json')) continue;
  const post = JSON.parse(fs.readFileSync(path.join(POSTS_DIR, file), 'utf-8'));
  const slug = cleanSlug(post.slug);
  if (ONLY && slug !== ONLY) continue;

  const entry = { file, slug, title: post.title, failed: [], diffs: {} };
  const startedAt = Date.now();
  try {
    const first = roundTrip(post.content_html);
    const before = fingerprint(post.content_html);
    const after = fingerprint(first.html);

    for (const key of CHECKS) {
      if (!same(before[key], after[key])) {
        entry.failed.push(key);
        entry.diffs[key] = typeof before[key] === 'number' ? { before: before[key], after: after[key] } : firstDiff(before[key], after[key]);
      }
    }
    // حفظ الشكل القانوني مرة أخرى يجب ألا يغيّر فيه حرفاً
    if (editorPass(first.html).html !== first.html) entry.failed.push('stable');
    entry.settledOnFirstPass = first.settledOnFirstPass;

    let rawHere = 0;
    first.doc.descendants((node) => {
      if (node.type.name !== 'rawBlock') return;
      rawHere++;
      const tag = (/^<([a-z0-9]+)/i.exec(node.attrs.html) || [, '?'])[1].toLowerCase();
      rawStats[tag] = (rawStats[tag] || 0) + 1;
    });
    if (rawHere) postsWithRaw++;
    entry.rawBlocks = rawHere;
    entry.sizeBefore = post.content_html.length;
    entry.sizeAfter = first.html.length;
  } catch (err) {
    entry.failed.push('error');
    entry.error = String(err && err.stack ? err.stack.split('\n').slice(0, 3).join(' | ') : err);
  }
  entry.ms = Date.now() - startedAt;
  if (VERBOSE && entry.ms > 5000) console.error(`  (بطيئة: ${file} — ${(entry.ms / 1000).toFixed(1)}ث)`);
  results.push(entry);
}

const total = results.length;
const passed = results.filter((r) => r.failed.length === 0);
const failed = results.filter((r) => r.failed.length > 0);
const textLoss = results.filter((r) => r.failed.includes('text') || r.failed.includes('error'));
const rate = total ? passed.length / total : 0;

console.log(`التدوينات: ${total}  (${(results.reduce((a, r) => a + r.ms, 0) / 1000).toFixed(0)} ثانية)`);
console.log(`تطابق كامل: ${passed.length} (${(rate * 100).toFixed(1)}%)`);
for (const key of [...CHECKS, 'stable', 'error']) {
  const n = results.filter((r) => r.failed.includes(key)).length;
  if (n) console.log(`  ✗ ${LABELS[key] || 'خطأ'}: ${n}`);
}
console.log(
  `كتل محفوظة كما هي: ${Object.values(rawStats).reduce((a, b) => a + b, 0)} في ${postsWithRaw} تدوينة` +
    (Object.keys(rawStats).length
      ? ` (${Object.entries(rawStats)
          .sort((a, b) => b[1] - a[1])
          .map(([t, n]) => `${t}×${n}`)
          .join('، ')})`
      : '')
);

console.log(`احتاجت مروراً ثانياً لتثبت (مسافة في أول فقرة): ${results.filter((r) => r.settledOnFirstPass === false).length}`);

if (failed.length) {
  console.log('\nالتدوينات غير المتطابقة:');
  for (const r of failed) {
    console.log(`  ${r.file}  [${r.failed.map((k) => LABELS[k] || k).join('، ')}]`);
    if (r.error) console.log(`     ${r.error}`);
    if (VERBOSE) for (const [k, d] of Object.entries(r.diffs)) console.log(`     ${k}: ${JSON.stringify(d)}`);
  }
}

if (JSON_OUT) {
  fs.writeFileSync(JSON_OUT, JSON.stringify({ total, passed: passed.length, rate, rawStats, postsWithRaw, failed }, null, 2) + '\n');
  console.log(`\nالتقرير الكامل: ${JSON_OUT}`);
}

const ok = textLoss.length === 0 && rate >= PASS_RATE_REQUIRED;
console.log(
  ok
    ? `\n✅ البوابة ناجحة: لا فقدان نص، والتطابق ${(rate * 100).toFixed(1)}% ≥ ${PASS_RATE_REQUIRED * 100}%.`
    : `\n⛔ البوابة فاشلة: ${textLoss.length} تدوينة بفقدان نص، والتطابق ${(rate * 100).toFixed(1)}% (المطلوب ${PASS_RATE_REQUIRED * 100}%).`
);
process.exit(ok || ONLY ? 0 : 1);
