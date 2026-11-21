/**
 * جسم التدوينة بين HTML ومستند المحرّر: التحميل والتسلسل.
 *
 * مصدر واحد لثلاثة مستعملين، وإلا اختلف ما يُحفظ عمّا اختُبر:
 *   - المتصفح (src/scripts/studio/editor.ts): يحمّل التدوينة ويسلسلها عند الحفظ.
 *   - scripts/studio-roundtrip.mjs: يثبت أن التحميل والحفظ لا يُسقطان شيئاً من الأرشيف.
 *   - scripts/studio-editor-check.mjs: يثبت أن ما يخرج من هنا يقبله فاحص الخادم.
 * لذلك لا يُستعمل `content` النصّي في TipTap ولا `editor.getHTML()` — كلاهما يمرّ بتحليل
 * خاص به. الـDOM يُمرَّر من الخارج (`document`): نافذة المتصفح، أو jsdom في Node.
 *
 * شكلان للـHTML:
 *   - الموسَّع: ما يُخزَّن في `content_html` ويراه الزائر.
 *   - بالعناصر النائبة: الكتل المحفوظة فيه ‎<div data-raw-block="…">‎. هذا ما يرسله المتصفح
 *     للخادم، ليعرف الخادم بالضبط أين تبدأ كل كتلة محفوظة وأين تنتهي (sanitize.ts).
 */

import { getSchema } from '@tiptap/core';
import { DOMParser as PMDOMParser, DOMSerializer } from '@tiptap/pm/model';
import { expandRawBlocks, studioExtensions } from './schema.js';

export const schema = getSchema(studioExtensions);

const parser = PMDOMParser.fromSchema(schema);
const serializer = DOMSerializer.fromSchema(schema);

/**
 * HTML → مستند (مرور واحد). التحليل داخل عنصر ‎<body>‎ منفصل: نفس سياق صفحة حقيقية.
 * @param {string} html
 * @param {Document} document
 */
export function parseBody(html, document) {
  const body = document.createElement('body');
  body.innerHTML = html;
  return parser.parse(body);
}

/**
 * مستند → HTML بالعناصر النائبة.
 * @param {import('@tiptap/pm/model').Node} doc
 * @param {Document} document
 */
export function serializeBody(doc, document) {
  const holder = document.createElement('div');
  holder.appendChild(serializer.serializeFragment(doc.content, { document }));
  return holder.innerHTML;
}

/**
 * تحميل تدوينة مخزَّنة للتحرير: الشكل القانوني = مروران. المرور الأول يُبقي أحياناً مسافة
 * في أول الفقرة يحذفها الثاني، ثم يثبت الناتج — فلا يُنتج «حفظ بلا تعديل» فرقاً في Git.
 *
 * @param {string} html الشكل الموسَّع المخزَّن
 * @param {Document} document
 * @returns {{ doc: import('@tiptap/pm/model').Node, html: string }} المستند، وتسلسله بالعناصر النائبة
 */
export function loadBody(html, document) {
  const firstPass = expandRawBlocks(serializeBody(parseBody(html, document), document));
  const doc = parseBody(firstPass, document);
  return { doc, html: serializeBody(doc, document) };
}

const TRAILING_EMPTY_PARAGRAPHS = /(?:<p><\/p>)+$/;

/**
 * ما يُرسَل للحفظ: تسلسل المستند بلا فقرات فارغة في آخره. المحرّر يضيف فقرة فارغة بعد
 * آخر جدول أو قائمة ليجد المؤشّر مكاناً يقف فيه — وهذه لا تُحفظ، وإلا عُدّ فتح التدوينة
 * تعديلاً لها. (‎<p><br></p>‎ سطر فارغ مقصود، ولا يُمسّ.)
 *
 * @param {import('@tiptap/pm/model').Node} doc
 * @param {Document} document
 */
export function bodyForSave(doc, document) {
  return serializeBody(doc, document).replace(TRAILING_EMPTY_PARAGRAPHS, '');
}
