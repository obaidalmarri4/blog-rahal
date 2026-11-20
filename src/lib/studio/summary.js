/**
 * ملخّص التدوينة في قائمة اللوحة: الحقول الخفيفة فقط، بلا نص التدوينة.
 *
 * يُستعمل في مكانين ويجب أن يعطي الناتج نفسه فيهما:
 *   - وقت البناء: index-plugin.mjs يلخّص كل الملفات في «فهرس» يُحزم مع دالة الخادم.
 *   - وقت الطلب: store.ts يلخّص الملفات التي تغيّرت على الفرع بعد البناء.
 * (ملف JavaScript لا TypeScript ليستورده astro.config.mjs مباشرة.)
 */

import { createHash } from 'node:crypto';
import { cleanSlug } from '../../../scripts/lib/post-html.mjs';

/**
 * معرّف محتوى الملف كما يحسبه Git (‎git hash-object‎). به تعرف اللوحة — بلا تنزيل أي ملف —
 * أيّ التدوينات تغيّر على الفرع عمّا بُني منه الموقع.
 * @param {Buffer} bytes
 */
export function gitBlobOid(bytes) {
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

/**
 * @param {Record<string, any>} post محتوى ملف التدوينة
 * @param {string} file اسم الملف في src/content/posts
 * @param {string} oid
 */
export function summarizePost(post, file, oid) {
  const image = Array.isArray(post.images) ? post.images[0] : null;
  const cover = image?.thumbnail_url || image?.original_url || '';
  return {
    file,
    oid,
    slug: cleanSlug(String(post.slug ?? '')),
    title: String(post.title ?? ''),
    date: String(post.date ?? ''),
    labels: Array.isArray(post.labels) ? post.labels.map(String) : [],
    imageCount: Number(post.image_count) || 0,
    // في الأرشيف صور لُصقت من Word بروابط ‎file:///C:/…‎: يُعرض رابط الويب أو مسار الموقع فقط
    cover: /^(https?:\/\/|\/(?!\/))/.test(cover) ? cover : null,
    url: String(post.url ?? ''),
  };
}
