/**
 * قائمة التدوينات المحذوفة من لوحة التحرير (src/data/removed-posts.json).
 *
 * الحذف من اللوحة لا يحذف التدوينة من Blogger، والمزامنة تستورد كل ما في Blogger وليس
 * محلياً — فلولا هذه القائمة لرجعت التدوينة المحذوفة خلال ثلاث ساعات.
 */

import fs from 'node:fs';
import { cleanSlug } from './post-html.mjs';

/**
 * @param {string} file مسار removed-posts.json
 * @returns {Set<string>} slugs المحذوفة؛ فارغة إن لم يوجد الملف
 */
export function readRemovedSlugs(file) {
  if (!fs.existsSync(file)) return new Set();
  // ملف معطوب يجب أن يُسقط المزامنة لا أن يُتجاهل: تجاهله يعيد كل المحذوفات إلى الموقع
  const { posts } = JSON.parse(fs.readFileSync(file, 'utf-8'));
  if (!Array.isArray(posts)) throw new Error(`${file}: الحقل posts يجب أن يكون مصفوفة`);
  return new Set(posts.map((post) => cleanSlug(String(post.slug))));
}
