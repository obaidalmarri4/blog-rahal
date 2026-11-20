#!/usr/bin/env node
/**
 * يستخرج الصور المضمّنة داخل نص التدوينة (‎<img src="data:image/…;base64,…">‎) إلى ملفات
 * حقيقية في public/media/posts/<slug>/ ويضع مكانها رابطاً.
 *
 * لماذا: محرّر Blogger يقبل لصق الصور مباشرة فتُخزَّن داخل الـHTML نفسه. تدوينة واحدة
 * بهذه الطريقة وصلت 43MB — صفحتها لا تُفتح على الجوال، ولا تمرّ من لوحة التحرير (حدّ جسم
 * الطلب في دوال Vercel هو 4.5MB).
 *
 * الاستعمال:
 *   node scripts/extract-inline-images.mjs --dry-run   عرض ما سيُستخرج بدون كتابة
 *   node scripts/extract-inline-images.mjs             الاستخراج الفعلي
 *
 * - آمن للتكرار: تدوينة بلا صور مضمّنة لا تُمسّ.
 * - الصور الأكبر من 500KB يُعاد ضغطها (JPEG جودة 85، أقصى ضلع 2000px) إن كانت مكتبة
 *   sharp متوفّرة (تأتي مع Astro). الأصل يبقى في سجل Git لمن يحتاجه.
 * - لا يغيّر نص التدوينة ولا ترتيب الصور؛ يبدّل قيمة src فقط ويضيف loading="lazy".
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { cleanSlug, serializePost } from './lib/post-html.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const POSTS_DIR = path.join(ROOT, 'src/content/posts');
const MEDIA_DIR = path.join(ROOT, 'public/media/posts');
const DRY_RUN = process.argv.includes('--dry-run');
const RECOMPRESS_OVER = 500 * 1024;
const MAX_EDGE = 2000;

let sharp = null;
try {
  sharp = (await import('sharp')).default;
} catch {
  console.warn('⚠️  sharp غير متوفّرة — ستُكتب الصور بحجمها الأصلي بلا ضغط.');
}

const DATA_URI = /^data:image\/[a-z0-9.+-]+;base64,(.*)$/is;

/** النوع الحقيقي من أول بايتات الملف — Blogger يسمّي صور JPEG «image/png» أحياناً */
function sniff(buf) {
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.subarray(0, 3).toString('latin1') === 'GIF') return 'gif';
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  return null;
}

async function optimize(buf, ext) {
  if (!sharp || buf.length <= RECOMPRESS_OVER || (ext !== 'jpg' && ext !== 'png')) return { buf, ext };
  const image = sharp(buf);
  const meta = await image.metadata();
  if (ext === 'png' && meta.hasAlpha) return { buf, ext }; // الشفافية لا تُحفظ في JPEG
  const out = await image
    .rotate() // يطبّق اتجاه EXIF قبل حذف البيانات الوصفية
    .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85, mozjpeg: true })
    .toBuffer();
  return out.length < buf.length ? { buf: out, ext: 'jpg' } : { buf, ext };
}

const kb = (n) => `${Math.round(n / 1024)}KB`;
let postsTouched = 0;
let imagesWritten = 0;

for (const file of fs.readdirSync(POSTS_DIR).sort()) {
  if (!file.endsWith('.json')) continue;
  const filePath = path.join(POSTS_DIR, file);
  const raw = fs.readFileSync(filePath, 'utf-8');
  if (!raw.includes('data:image/')) continue;

  const post = JSON.parse(raw);
  const slug = cleanSlug(post.slug);
  const dir = path.join(MEDIA_DIR, slug);
  const byHash = new Map(); // بصمة البايتات الأصلية → الرابط الجديد
  const pending = []; // ملفات تُكتب بعد نجاح معالجة التدوينة كلها
  let skipped = 0;

  async function urlFor(dataUri) {
    const m = DATA_URI.exec(dataUri);
    if (!m) return null;
    const original = Buffer.from(m[1], 'base64');
    const hash = crypto.createHash('sha256').update(original).digest('hex');
    if (byHash.has(hash)) return byHash.get(hash);
    const type = sniff(original);
    if (!type) return null;
    const { buf, ext } = await optimize(original, type);
    const name = `${String(byHash.size + 1).padStart(2, '0')}.${ext}`;
    const url = `/media/posts/${slug}/${name}`;
    byHash.set(hash, url);
    pending.push({ name, buf, from: original.length });
    return url;
  }

  // 1) الصور داخل النص
  const tags = [...post.content_html.matchAll(/<img\b[^>]*>/gi)];
  let html = '';
  let cursor = 0;
  for (const t of tags) {
    const src = /\bsrc=(["'])(data:image\/[^"']*)\1/i.exec(t[0]);
    if (!src) continue;
    const url = await urlFor(src[2]);
    if (!url) {
      skipped++;
      continue;
    }
    let tag = t[0].replace(src[0], `src="${url}"`);
    if (!/\bloading=/i.test(tag)) tag = tag.replace(/\s*\/?>$/, (end) => ` loading="lazy"${end.trim()}`);
    html += post.content_html.slice(cursor, t.index) + tag;
    cursor = t.index + t[0].length;
  }
  html += post.content_html.slice(cursor);

  // 2) قائمة images[] (يقرأ منها الألبوم والغلاف)
  let listFixed = 0;
  for (const img of post.images || []) {
    const dataField = [img.original_url, img.thumbnail_url].find((u) => typeof u === 'string' && u.startsWith('data:'));
    if (!dataField) continue;
    const url = await urlFor(dataField);
    if (!url) {
      skipped++;
      continue;
    }
    img.original_url = url;
    img.thumbnail_url = url;
    img.local_path = `public${url}`;
    listFixed++;
  }

  if (pending.length === 0) {
    if (skipped) console.log(`⚠️  ${file}: ${skipped} صورة مضمّنة بصيغة غير معروفة — تُركت كما هي`);
    continue;
  }

  const before = raw.length;
  post.content_html = html;
  const next = serializePost(post, raw);
  console.log(
    `${DRY_RUN ? '🔎' : '✅'} ${file}: ${pending.length} صورة` +
      (listFixed ? ` (+${listFixed} في images[])` : '') +
      ` | الملف ${kb(before)} → ${kb(next.length)}`
  );
  for (const p of pending) console.log(`     ${p.name}  ${kb(p.from)} → ${kb(p.buf.length)}`);
  if (skipped) console.log(`     ⚠️  ${skipped} صورة بصيغة غير معروفة تُركت كما هي`);

  postsTouched++;
  imagesWritten += pending.length;
  if (DRY_RUN) continue;

  fs.mkdirSync(dir, { recursive: true });
  for (const p of pending) fs.writeFileSync(path.join(dir, p.name), p.buf);
  fs.writeFileSync(filePath, next, 'utf-8');
}

console.log(
  postsTouched === 0
    ? 'لا توجد صور مضمّنة — لا شيء للاستخراج.'
    : `\n${DRY_RUN ? '(--dry-run: لم يُكتب شيء) ' : ''}${imagesWritten} صورة في ${postsTouched} تدوينة.`
);
