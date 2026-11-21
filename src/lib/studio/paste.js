/**
 * تنظيف ما يُلصق في المحرّر (من Word، واتساب، صفحة ويب، Blogger) قبل أن يقرأه المخطط.
 *
 * المخطط نفسه يُسقط الوسوم التي لا يعرفها، لكنه يفهم حجم الخط واللون — وهذان في اللصق
 * ضجيج (‎11pt‎، ‎windowtext‎) يكسر تناسق الصفحة. فيُلصق النص ببنيته (فقرات، عناوين، قوائم،
 * روابط، عريض ومائل) بلا مقاسات ولا ألوان ولا خطوط؛ والتنسيق يُضاف بعدها من شريط الأدوات.
 *
 * الـDOM يُمرَّر من الخارج ليُختبر في Node بالدالة نفسها التي تعمل في المتصفح.
 */

import { RAW_BLOCK_TAGS } from './raw-blocks.js';

/** ما يبقى من ‎style‎: ما يقرأ منه المخطط العريض والمائل والتسطير (Google Docs يكتبها هكذا) */
const KEPT_STYLE = ['font-weight', 'font-style', 'text-decoration', 'text-decoration-line'];
const DROPPED_ATTRIBUTES = ['class', 'id', 'lang', 'dir', 'align', 'color', 'face', 'size', 'bgcolor', 'data-align'];
const NOISE = 'style, script, meta, link, title, xml, head';
/** حاويات تُفكّ ويبقى ما بداخلها */
const UNWRAPPED = ['figure', 'details', 'dl', 'fieldset', 'form', 'marquee', 'pre'];
const SHOW_COMMENT = 128;
const SHOW_TEXT = 4;

/**
 * @param {string} html
 * @param {Document} document
 * @returns {string}
 */
export function cleanPastedHTML(html, document) {
  const body = document.createElement('body');
  body.innerHTML = html;

  for (const element of body.querySelectorAll(NOISE)) element.remove();

  // تعليقات Word الشرطية ‎<!--[if gte mso 9]>…‎
  const comments = [];
  const commentWalker = document.createTreeWalker(body, SHOW_COMMENT);
  while (commentWalker.nextNode()) comments.push(commentWalker.currentNode);
  for (const comment of comments) comment.remove();

  // الجدول يصير فقرات (صف في كل فقرة). لو بقي جدولاً لصار «كتلة محفوظة» جديدة — والخادم
  // لا يقبل كتلة لم تكن في التدوينة، فيفشل الحفظ بلا سبب يفهمه الكاتب.
  for (const table of [...body.querySelectorAll('table')]) {
    if (!body.contains(table)) continue; // جدول داخل جدول استُبدل مع أبيه
    const rows = [];
    for (const row of table.querySelectorAll('tr')) {
      if (row.closest('table') !== table) continue;
      const cells = [...row.children].map((cell) => cell.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean);
      if (cells.length === 0) continue;
      const paragraph = document.createElement('p');
      paragraph.textContent = cells.join(' — ');
      rows.push(paragraph);
    }
    table.replaceWith(...rows);
  }

  for (const tag of RAW_BLOCK_TAGS) {
    for (const element of [...body.querySelectorAll(tag)]) {
      if (!body.contains(element)) continue;
      if (UNWRAPPED.includes(tag)) element.replaceWith(...element.childNodes);
      else element.remove(); // iframe، فيديو، svg…: لا تُلصق
    }
  }

  for (const element of body.querySelectorAll('*')) {
    // صور الحافظة المحلية (‎file:‎، ‎blob:‎، ‎data:‎، ‎cid:‎) لا تصل الموقع أبداً
    if (element.tagName === 'IMG') {
      if (!/^https?:\/\//i.test(element.getAttribute('src') || '')) {
        element.remove();
        continue;
      }
      for (const name of ['width', 'height', 'border', 'hspace', 'vspace']) element.removeAttribute(name);
    }

    const style = element.getAttribute('style');
    if (style !== null) {
      const kept = style
        .split(';')
        .map((declaration) => declaration.trim())
        .filter((declaration) => KEPT_STYLE.includes(declaration.split(':')[0].trim().toLowerCase()));
      if (kept.length > 0) element.setAttribute('style', kept.join('; '));
      else element.removeAttribute('style');
    }
    for (const name of DROPPED_ATTRIBUTES) element.removeAttribute(name);
  }

  // المسافة غير القابلة للكسر التي يلصقها Blogger و Word بين الكلمات: تمنع التفاف السطر على الجوال
  const textWalker = document.createTreeWalker(body, SHOW_TEXT);
  while (textWalker.nextNode()) {
    const node = textWalker.currentNode;
    if (node.nodeValue.includes('\u00A0')) node.nodeValue = node.nodeValue.replace(/\u00A0/g, ' ');
  }

  return body.innerHTML;
}
