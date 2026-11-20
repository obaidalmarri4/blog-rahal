/**
 * إضافة Vite: الوحدة الافتراضية ‎`virtual:studio-index`‎ — فهرس خفيف لكل التدوينات يُحسب وقت
 * البناء ويُحزم مع دالة الخادم.
 *
 * لماذا: قائمة اللوحة تحتاج عنوان وتاريخ 466 تدوينة. استيراد ملفاتها يحزم 36MB من النصوص
 * في الدالة، وجلبها من GitHub عند كل فتح أبطأ من أن يُحتمل. الفهرس ~150KB، ومعه معرّف كل
 * ملف (oid) — فتقارنه اللوحة بما على الفرع وتجلب ما تغيّر بعد البناء فقط.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gitBlobOid, summarizePost } from './summary.js';

const VIRTUAL_ID = 'virtual:studio-index';
const RESOLVED_ID = `\0${VIRTUAL_ID}`;
const POSTS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../content/posts');

export function buildStudioIndex(postsDir = POSTS_DIR) {
  return fs
    .readdirSync(postsDir)
    .filter((file) => file.endsWith('.json'))
    .sort()
    .map((file) => {
      const bytes = fs.readFileSync(path.join(postsDir, file));
      return summarizePost(JSON.parse(bytes.toString('utf-8')), file, gitBlobOid(bytes));
    });
}

/** @returns {import('vite').Plugin} */
export function studioIndex() {
  return {
    name: 'rahal-studio-index',
    resolveId(id) {
      return id === VIRTUAL_ID ? RESOLVED_ID : undefined;
    },
    load(id) {
      return id === RESOLVED_ID ? `export default ${JSON.stringify(buildStudioIndex())};` : undefined;
    },
  };
}
