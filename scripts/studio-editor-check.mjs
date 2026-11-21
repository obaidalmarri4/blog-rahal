#!/usr/bin/env node
/**
 * بوابة محرّر النص في لوحة التحرير: ما يخرج من المحرّر يقبله الخادم، وما عداه يرفضه.
 *
 * تجمع الطرفين اللذين يجب أن يتّفقا:
 *   - المتصفح: src/lib/studio/document.js (تحميل وتسلسل) و paste.js (تنظيف اللصق)
 *   - الخادم:  src/lib/studio/sanitize.ts (فحص ما يُرسَل قبل حفظه)
 * بالدوال نفسها التي تعمل في الموقع، و jsdom مكان المتصفح.
 *
 * ما تثبته:
 *   ١. كل تدوينة في الأرشيف تُفتح وتُحفظ: الخادم يقبلها، والمحفوظ هو ما سلسله المحرّر حرفياً،
 *      وفتحها وحفظها مرة ثانية لا يغيّر شيئاً، وقائمة صورها لا تتغيّر بلا تعديل.
 *   ٢. حذف فقرة أو صورة لا يغيّر حرفاً في باقي النص.
 *   ٣. ما لا يكتبه المحرّر (سكربت، سمة حدث، رابط javascript، كتلة لم تكن في التدوينة…) مرفوض.
 *   ٤. اللصق من Word و Google Docs يدخل بلا خطوط ولا مقاسات ولا ألوان.
 *
 * الاستعمال:  node scripts/studio-editor-check.mjs          (لا يحتاج بناءً)
 * شغّله بعد أي تغيير في schema.js أو document.js أو paste.js أو sanitize.ts أو raw-blocks.js،
 * ومع scripts/studio-roundtrip.mjs (ذاك يثبت أن التحميل نفسه لا يُسقط شيئاً من الأرشيف).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { Transform } from '@tiptap/pm/transform';
import { extractImages, reconcileImages } from './lib/post-html.mjs';
import { bodyForSave, loadBody, parseBody, schema } from '../src/lib/studio/document.js';
import { FONT_SIZES, TEXT_COLORS } from '../src/lib/studio/formatting.js';
import { cleanPastedHTML } from '../src/lib/studio/paste.js';
import { expandRawBlocks, splitRawBlocks } from '../src/lib/studio/raw-blocks.js';
import { checkBody } from '../src/lib/studio/sanitize.ts';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const POSTS_DIR = path.join(ROOT, 'src/content/posts');
const { document } = new JSDOM('<!doctype html><html><body></body></html>').window;

let failures = 0;
let total = 0;
const section = (title) => console.log(`\n${title}`);
function check(label, ok, detail = '') {
  total++;
  if (!ok) failures++;
  console.log(`  ${ok ? '✓' : '✗'} ${label}${!ok && detail ? `\n      ${detail}` : ''}`);
}
const listed = (files) => (files.length ? `${files.length}: ${files.slice(0, 4).join('، ')}` : '');

/** ما يفعله المتصفح عند «حفظ»: تسلسل المستند ← صيغة الإرسال ← فحص الخادم */
function save(doc, stored) {
  const html = bodyForSave(doc, document);
  const wire = splitRawBlocks(html);
  return { html, wire, result: checkBody(wire.html, wire.raw, stored) };
}

const posts = fs
  .readdirSync(POSTS_DIR)
  .filter((file) => file.endsWith('.json'))
  .sort()
  .map((file) => ({ file, ...JSON.parse(fs.readFileSync(path.join(POSTS_DIR, file), 'utf-8')) }));

// ── 1. الأرشيف كله ──────────────────────────────────────────────────────────

section(`١. فتح وحفظ كل تدوينة في الأرشيف (${posts.length})`);

const rejected = [];
const altered = [];
const unstable = [];
const imagesMoved = [];
const loadedPosts = [];
let largestRequest = 0;

for (const post of posts) {
  const loaded = loadBody(post.content_html, document);
  const { html, wire, result } = save(loaded.doc, post.content_html);
  largestRequest = Math.max(largestRequest, JSON.stringify(wire).length);
  if (!result.ok) {
    rejected.push(`${post.file} (${result.reason})`);
    continue;
  }
  if (result.html !== expandRawBlocks(html)) altered.push(post.file);
  // المحفوظ يُفتح من جديد: يجب أن يُحفظ بلا أي فرق، والخادم يقبله مقابل نفسه
  const again = save(loadBody(result.html, document).doc, result.html);
  if (!again.result.ok || again.result.html !== result.html) unstable.push(post.file);
  if (JSON.stringify(reconcileImages(post.images, post.content_html, result.html)) !== JSON.stringify(post.images)) imagesMoved.push(post.file);
  loadedPosts.push({ post, doc: loaded.doc, saved: result.html });
}

check('الخادم يقبل كل تدوينة كما يسلسلها المحرّر', rejected.length === 0, listed(rejected));
check('ما يُخزَّن هو ما سلسله المحرّر حرفاً بحرف', altered.length === 0, listed(altered));
check('فتح المحفوظ وحفظه مرة ثانية لا يغيّر شيئاً', unstable.length === 0, listed(unstable));
check('قائمة الصور ‎images[]‎ لا تتغيّر ما دامت الصور لم تُمسّ', imagesMoved.length === 0, listed(imagesMoved));
check(`أكبر طلب حفظ (${Math.round(largestRequest / 1024)}KB) تحت حد دوال Vercel بهامش واسع`, largestRequest < 2_000_000);

// ── 2. الحذف الجزئي ─────────────────────────────────────────────────────────

section('٢. حذف فقرة وصورة لا يغيّر حرفاً في الباقي');

/** نص كل كتلة بترتيبها. الفقرات الفارغة في آخر التدوينة لا تُحفظ أصلاً (bodyForSave) */
const blockTexts = (doc) => {
  const texts = [];
  doc.forEach((node) => texts.push(node.textContent));
  while (texts.length > 0 && texts.at(-1) === '') texts.pop();
  return texts;
};
/** النص بلا مسافات: حذف صورة يترك المسافة التي بجوارها في طرف الفقرة، والتحميل يسقطها */
const lettersOf = (doc) => doc.textContent.replace(/\s+/g, '');
const imageSources = (doc) => {
  const sources = [];
  doc.descendants((node) => {
    if (node.type.name === 'image') sources.push(node.attrs.src);
  });
  return sources;
};
const rawCount = (doc) => {
  let count = 0;
  doc.descendants((node) => void (node.type.name === 'rawBlock' && count++));
  return count;
};

let paragraphsTried = 0;
let imagesTried = 0;
const paragraphBroken = [];
const imageBroken = [];
const listBroken = [];

for (const { post, doc, saved } of loadedPosts) {
  // فقرة غير فارغة من وسط التدوينة
  const candidates = [];
  doc.forEach((node, offset, index) => {
    if (node.type.name === 'paragraph' && node.textContent.trim() && index > 0 && index < doc.childCount - 1) candidates.push({ offset, index, size: node.nodeSize });
  });
  if (candidates.length > 0) {
    paragraphsTried++;
    const target = candidates[Math.floor(candidates.length / 2)];
    const edited = new Transform(doc).delete(target.offset, target.offset + target.size).doc;
    const { result } = save(edited, saved);
    const reloaded = result.ok ? loadBody(result.html, document).doc : null;
    const expected = blockTexts(doc).filter((_, index) => index !== target.index);
    while (expected.length > 0 && expected.at(-1) === '') expected.pop();
    if (!reloaded || JSON.stringify(blockTexts(reloaded)) !== JSON.stringify(expected) || JSON.stringify(imageSources(reloaded)) !== JSON.stringify(imageSources(edited)) || rawCount(reloaded) !== rawCount(edited)) {
      paragraphBroken.push(post.file);
    }
  }

  // أول صورة في التدوينة
  let found = null;
  doc.descendants((node, position) => {
    if (!found && node.type.name === 'image') found = { position, size: node.nodeSize, src: node.attrs.src };
  });
  if (found) {
    imagesTried++;
    const edited = new Transform(doc).delete(found.position, found.position + found.size).doc;
    const { result } = save(edited, saved);
    const reloaded = result.ok ? loadBody(result.html, document).doc : null;
    const expectedSources = imageSources(doc);
    expectedSources.splice(expectedSources.indexOf(found.src), 1);
    if (!reloaded || lettersOf(reloaded) !== lettersOf(doc) || JSON.stringify(imageSources(reloaded)) !== JSON.stringify(expectedSources)) {
      imageBroken.push(post.file);
    } else if (!expectedSources.includes(found.src)) {
      // الصورة لم تعد في الجسم: مدخلها يخرج من القائمة، وباقي القائمة كما هو
      const before = post.images ?? [];
      const after = reconcileImages(before, saved, result.html);
      const stillListed = after.some((image) => image.original_url === found.src || image.thumbnail_url === found.src);
      const othersKept = after.every((image) => before.includes(image)) && before.length - after.length <= 1;
      if (stillListed || !othersKept) listBroken.push(post.file);
    }
  }
}

check(`حذف فقرة من وسط التدوينة (${paragraphsTried} تدوينة): باقي الفقرات والصور والكتل كما هي`, paragraphBroken.length === 0, listed(paragraphBroken));
check(`حذف أول صورة (${imagesTried} تدوينة): النص كله كما هو، وباقي الصور بترتيبها`, imageBroken.length === 0, listed(imageBroken));
check('الصورة المحذوفة تخرج من ‎images[]‎ وحدها، وباقي القائمة لا يُمسّ', listBroken.length === 0, listed(listBroken));

// ── 3. ما لا يكتبه المحرّر ──────────────────────────────────────────────────

section('٣. الخادم يرفض ما لا يكتبه المحرّر');

const TABLE = '<table><tbody><tr><td>خانة</td></tr></tbody></table>';
const VIDEO = '<iframe src="https://www.youtube.com/embed/abcdefghijk" width="560" height="315"></iframe>';
const STORED = `<p>فقرة</p>${TABLE}<p>بعد الجدول</p>${VIDEO}`;
const verdict = (html, raw = []) => checkBody(html, raw, STORED);

const HOSTILE = [
  ['وسم script', '<p>نص</p><script>alert(1)</script>'],
  ['سمة حدث على فقرة', '<p onclick="alert(1)">نص</p>'],
  ['سمة حدث على صورة', '<p><img src="https://x.example/a.jpg" onerror="alert(1)"></p>'],
  ['رابط javascript', '<p><a href="javascript:alert(1)">رابط</a></p>'],
  ['رابط javascript بمسافة مدسوسة', '<p><a href="java&#9;script:alert(1)">رابط</a></p>'],
  ['رابط vbscript', '<p><a href="vbscript:msgbox(1)">رابط</a></p>'],
  ['رابط data', '<p><a href="data:text/html,<script>alert(1)</script>">رابط</a></p>'],
  ['صورة data', '<p><img src="data:image/svg+xml,<svg onload=alert(1)>"></p>'],
  ['صورة javascript', '<p><img src="javascript:alert(1)"></p>'],
  ['srcset على صورة', '<p><img src="https://x.example/a.jpg" srcset="https://evil.example/b.jpg 2x"></p>'],
  ['style فيه خاصية غير مسموحة', '<p><span style="position: fixed">نص</span></p>'],
  ['style فيه url()', '<p><span style="background-color: url(//evil.example/x)">نص</span></p>'],
  ['style فيه خاصيتان إحداهما مدسوسة', '<p><span style="color: red; inset: 0">نص</span></p>'],
  ['style على فقرة', '<p style="color: red">نص</p>'],
  ['class على فقرة', '<p class="fixed inset-0 z-50">نص</p>'],
  ['class على رابط', '<p><a href="https://x.example" class="fixed inset-0">رابط</a></p>'],
  ['id على عنوان', '<h2 id="post-content-body">عنوان</h2>'],
  ['iframe مكتوب مباشرة', '<iframe src="https://evil.example/"></iframe>'],
  ['جدول مكتوب مباشرة', TABLE],
  ['svg', '<svg onload="alert(1)"></svg>'],
  ['math', '<math><mi>x</mi></math>'],
  ['وسم style', '<style>body{display:none}</style>'],
  ['نموذج', '<form action="https://evil.example"><input name="q"></form>'],
  ['object', '<object data="https://evil.example/x.swf"></object>'],
  ['embed', '<embed src="https://evil.example/x.swf">'],
  ['link', '<link rel="stylesheet" href="https://evil.example/x.css">'],
  ['meta', '<meta http-equiv="refresh" content="0;url=https://evil.example">'],
  ['base', '<base href="https://evil.example/">'],
  ['div عادي', '<div>نص</div>'],
  ['تعليق', '<p>نص</p><!-- تعليق -->'],
  ['محاذاة غير التوسيط', '<p data-align="left">نص</p>'],
  ['سمة data غير معروفة', '<p data-x="1">نص</p>'],
  ['ترقيم قائمة غير رقمي', '<ol start="1;x"><li><p>بند</p></li></ol>'],
  ['target غريب', '<p><a href="https://x.example" target="javascript:alert(1)">رابط</a></p>'],
];
for (const [label, html] of HOSTILE) {
  const result = verdict(html);
  check(`${label}: مرفوض`, !result.ok, result.ok ? result.html : '');
}

const RAW_ATTACKS = [
  ['كتلة لم تكن في التدوينة', ['<table><tbody><tr><td>جدول جديد</td></tr></tbody></table>']],
  ['كتلة من التدوينة عُدّل فيها حرف', [TABLE.replace('خانة', 'خانه')]],
  ['كتلة من التدوينة أُضيفت لها سمة حدث', [TABLE.replace('<td>', '<td onclick="alert(1)">')]],
  ['كتلة من التدوينة ومعها سكربت', [`${TABLE}<script>alert(1)</script>`]],
  ['مقطع من التدوينة بعنوان آخر', [VIDEO.replace('abcdefghijk', 'zzzzzzzzzzz')]],
  ['نص عادي مكان الكتلة', ['<p>نص</p>']],
  ['سكربت مكان الكتلة', ['<script>alert(1)</script>']],
  ['مصفوفة الكتل فارغة والعنصر النائب يشير إليها', []],
];
for (const [label, raw] of RAW_ATTACKS) {
  const result = verdict('<p>فقرة</p><div data-raw-block="0"></div>', raw);
  check(`${label}: مرفوضة`, !result.ok, result.ok ? result.html : '');
}
check('عنصر نائب فيه محتوى: مرفوض', !verdict('<div data-raw-block="0"><script>alert(1)</script></div>', [TABLE]).ok);
check('عنصر نائب بسمة إضافية: مرفوض', !verdict('<div data-raw-block="0" onclick="alert(1)"></div>', [TABLE]).ok);
check('كتل ليست نصوصاً: مرفوضة', !verdict('<div data-raw-block="0"></div>', [{ toString: () => TABLE }]).ok);

section('٤. الخادم يقبل ما يكتبه المحرّر');

const LEGIT = [
  ['فقرات وعريض ومائل وتسطير وشطب', '<p>نص <strong>عريض</strong> <em>مائل</em> <u>مسطّر</u> <s>مشطوب</s> م<sup>2</sup> H<sub>2</sub>O</p>'],
  ['عنوان رئيسي وفرعي وتوسيط', '<h2 data-align="center">عنوان</h2><h3>فرعي</h3><p data-align="center">وسط</p><p dir="ltr">English</p>'],
  ...FONT_SIZES.filter((size) => size.value).map((size) => [`حجم «${size.label}»`, `<p><span style="font-size: ${size.value}">نص</span></p>`]),
  ...TEXT_COLORS.filter((color) => color.value).map((color) => [`لون «${color.label}»`, `<p><span style="color: ${color.value}">نص</span></p>`]),
  ['قوائم واقتباس وفاصل', '<ul><li><p>بند</p></li></ul><ol start="3"><li><p>بند</p></li></ol><blockquote><p>اقتباس</p></blockquote><hr>'],
  ['روابط', '<p><a href="https://x.example/a?b=1&amp;c=2" target="_blank" rel="noopener noreferrer">ويب</a> <a href="mailto:a@x.example">بريد</a> <a href="/blog/x">داخلي</a></p>'],
  ['صورة داخل رابط نسختها الكبيرة', '<p><a href="https://x.example/big.jpg"><img src="https://x.example/small.jpg" alt="وصف" width="320" height="240"></a></p>'],
  ['صورة من الموقع بمصغّرتها', '<p><img src="/media/posts/x/01.jpg" data-thumb="/media/posts/x/01-480.jpg" loading="lazy"></p>'],
  ['سطر فارغ', '<p>أ</p><p><br></p><p>ب</p>'],
];
for (const [label, html] of LEGIT) {
  const result = verdict(html);
  check(`${label}: مقبول ويُخزَّن كما هو`, result.ok && result.html === html, result.ok ? result.html : result.reason);
}

const moved = verdict('<div data-raw-block="1"></div><p>فقرة</p><div data-raw-block="0"></div>', [TABLE, VIDEO]);
check('كتل التدوينة نفسها بترتيب آخر: مقبولة وتُكتب في أماكنها الجديدة', moved.ok && moved.html === `${VIDEO}<p>فقرة</p>${TABLE}`, moved.ok ? moved.html : moved.reason);
check('حذف كتلة: مقبول', verdict('<p>فقرة</p><p>بعد الجدول</p>').ok);
check('جسم فارغ: مقبول', verdict('').ok);

// ── 5. اللصق ────────────────────────────────────────────────────────────────

section('٥. اللصق يدخل نظيفاً');

function paste(html) {
  const doc = parseBody(cleanPastedHTML(html, document), document);
  const { html: serialized, result } = save(doc, '');
  return { html: serialized, text: doc.textContent, accepted: result.ok, reason: result.ok ? '' : result.reason };
}

const word = paste(
  '<html><head><style>p.MsoNormal{font-family:Calibri}</style><!--[if gte mso 9]><xml><o:x/></xml><![endif]--></head><body>' +
    '<p class="MsoNormal" dir="RTL" style="text-align:right;line-height:150%"><span lang="AR-SA" style="font-size:16.0pt;font-family:&quot;Traditional Arabic&quot;;color:#C00000">نص&nbsp;من&nbsp;وورد <b>عريض</b></span><o:p></o:p></p>' +
    '<p class="MsoNormal"><font face="Arial" color="red" size="5">خط قديم</font></p>' +
    '<p><img src="file:///C:/Users/x/AppData/Local/Temp/clip_image001.png"><img src="https://x.example/kept.jpg" width="900" height="600"></p></body></html>'
);
check('لا خطوط ولا مقاسات ولا ألوان بعد اللصق من Word', !/style=|font-family|font-size|color/.test(word.html), word.html);
check('النص والعريض باقيان', word.text.includes('نص من وورد عريض') && word.html.includes('<strong>عريض</strong>') && word.text.includes('خط قديم'), word.html);
check('المسافة غير القابلة للكسر صارت مسافة عادية', !word.html.includes('&nbsp;') && !word.text.includes(String.fromCharCode(160)));
check('صورة الحافظة المحلية (file:) لا تدخل، وصورة الويب تدخل بلا مقاس مفروض', !word.html.includes('file:') && word.html.includes('<img src="https://x.example/kept.jpg">'), word.html);
check('والخادم يقبل الناتج', word.accepted, word.reason);

const docs = paste(
  '<b style="font-weight:normal" id="docs-internal-guid-1"><p dir="rtl" style="line-height:1.38"><span style="font-size:11pt;font-family:Arial;color:#000000;font-weight:400">عادي </span><span style="font-size:11pt;font-weight:700">عريض</span><span style="font-style:italic"> مائل</span></p></b>'
);
check('Google Docs: الغلاف ‎<b style="font-weight:normal">‎ لا يجعل النص كله عريضاً', docs.html === '<p>عادي <strong>عريض</strong><em> مائل</em></p>', docs.html);

const table = paste('<p>قبل</p><table><tr><td>أ</td><td>ب</td></tr><tr><td>ج</td><td>د</td></tr></table><iframe src="https://evil.example"></iframe><p>بعد</p>');
check('جدول ملصوق يصير فقرات (صف في كل فقرة)، ولا يصير كتلة يرفضها الخادم', table.accepted && table.html === '<p>قبل</p><p>أ — ب</p><p>ج — د</p><p>بعد</p>', `${table.html} ${table.reason}`);

const hostile = paste('<p onclick="alert(1)">نص<script>alert(1)</script></p><a href="javascript:alert(1)">رابط</a><svg onload="alert(1)"></svg>');
check('لصق عدائي: لا يبقى منه إلا نصّه', hostile.accepted && !/script|onclick|onload|javascript|svg/.test(hostile.html), hostile.html);

// ── 6. شريط الأدوات والموقع العام ───────────────────────────────────────────

section('٦. ما يكتبه الشريط له تنسيق في الموقع العام');

const css = fs.readFileSync(path.join(ROOT, 'src/styles/global.css'), 'utf-8');
for (const [label, needle] of [
  ['التوسيط', '.post-content [data-align="center"]'],
  ['العنوان الرئيسي', '.post-content h2'],
  ['العنوان الفرعي', '.post-content h3'],
  ['القوائم النقطية', '.post-content ul'],
  ['القوائم المرقّمة', '.post-content ol'],
  ['الاقتباس', '.post-content blockquote'],
  ['الفاصل', '.post-content hr'],
]) {
  check(`${label}: قاعدة في global.css`, css.includes(needle));
}

// ── 7. صورة مرفوعة ──────────────────────────────────────────────────────────

section('٧. صورة مرفوعة من الجوال (Blob)');

// ما يدرجه المحرّر بعد الرفع (src/scripts/studio/editor.ts): فقرة فيها الصورة بنسختيها
const UPLOADED = 'https://abc123.public.blob.vercel-storage.com/posts/2026/11/k3Jx9QmZ2pLw';
const uploadedImage = () =>
  schema.nodes.paragraph.create(null, schema.nodes.image.create({ src: `${UPLOADED}.jpg`, thumb: `${UPLOADED}-thumb.jpg`, alt: 'وصف', loading: 'lazy' }));

const fresh = loadBody('', document).doc;
const freshDoc = new Transform(fresh).insert(0, [schema.nodes.paragraph.create(null, schema.text('نص التدوينة')), uploadedImage()]).doc;
const freshHtml = bodyForSave(freshDoc, document);
const freshVerdict = checkBody(freshHtml, [], '');
check('تدوينة جديدة بصورة مرفوعة: يقبلها الخادم كما هي', freshVerdict.ok && freshVerdict.html === freshHtml, freshVerdict.ok ? freshVerdict.html : freshVerdict.reason);
const freshImages = extractImages(freshHtml);
check(
  '…و‎images[]‎ تأخذ النسختين والوصف (الغلاف = أول صورة)',
  freshImages.length === 1 && freshImages[0].original_url === `${UPLOADED}.jpg` && freshImages[0].thumbnail_url === `${UPLOADED}-thumb.jpg` && freshImages[0].alt === 'وصف',
  JSON.stringify(freshImages)
);

const withPhotos = posts.find((post) => post.images.length >= 2 && post.content_html.length < 200_000);
const oldDoc = loadBody(withPhotos.content_html, document).doc;
const addedDoc = new Transform(oldDoc).insert(oldDoc.content.size, uploadedImage()).doc;
const addedHtml = expandRawBlocks(bodyForSave(addedDoc, document));
const addedWire = splitRawBlocks(bodyForSave(addedDoc, document));
const addedVerdict = checkBody(addedWire.html, addedWire.raw, withPhotos.content_html);
const reconciled = reconcileImages(withPhotos.images, withPhotos.content_html, addedHtml);
check('صورة مرفوعة تُضاف لتدوينة قديمة: يقبلها الخادم', addedVerdict.ok, addedVerdict.ok ? '' : addedVerdict.reason);
check(
  '…و‎images[]‎ القديمة كما هي حرفاً، والجديدة في آخرها',
  reconciled.length === withPhotos.images.length + 1 &&
    JSON.stringify(reconciled.slice(0, -1)) === JSON.stringify(withPhotos.images) &&
    reconciled.at(-1).original_url === `${UPLOADED}.jpg`,
  `${withPhotos.images.length} → ${reconciled.length}`
);

console.log(
  failures === 0
    ? `\n✅ البوابة ناجحة: ${total} فحصاً — المحرّر والخادم متّفقان على كل الأرشيف.`
    : `\n⛔ البوابة فاشلة: ${failures} من ${total} فحصاً.`
);
process.exit(failures === 0 ? 0 : 1);
