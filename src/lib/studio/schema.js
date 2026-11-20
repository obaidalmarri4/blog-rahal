/**
 * مخطط محرّر لوحة التحرير (/studio): ما الذي يفهمه المحرّر من HTML التدوينة وكيف يكتبه.
 *
 * يُستعمل في مكانين ويجب أن يبقى واحداً فيهما:
 *   - المتصفح: المحرّر نفسه.
 *   - Node: scripts/studio-roundtrip.mjs — بوابة الجودة التي تثبت أن فتح تدوينة قديمة
 *     وحفظها لا يُسقط منها نصاً ولا صورة.
 * لذلك لا يلمس هذا الملف window ولا document. (ملف JavaScript لا TypeScript ليُستورد من
 * Node مباشرة بلا بناء.)
 *
 * مبدآن يحكمان المخطط:
 *   1. ما لا يفهمه المحرّر لا يُحذف — يُحفظ حرفياً في «كتلة محفوظة» (rawBlock).
 *   2. لا يوجد نوع خط: جسم التدوينة بخط ثمانية دائماً، فـfont-family يسقط عمداً.
 */

import { Extension, Mark, Node } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Image } from '@tiptap/extension-image';

/**
 * وسوم تُحفظ كما هي: المحرّر لا يعرف بنيتها الداخلية، ولو فكّها لضاعت (الجدول يصير فقرات،
 * والفيديو يختفي). تظهر في المحرّر صندوقاً يُحذف أو يُنقل ولا يُعدَّل داخله.
 */
export const RAW_BLOCK_TAGS = [
  'table',
  'iframe',
  'video',
  'audio',
  'object',
  'embed',
  'form',
  'fieldset',
  'marquee',
  'svg',
  'dl',
  'pre',
  'figure',
  'details',
];

const RAW_PLACEHOLDER = /<div data-raw-block="([^"]*)"><\/div>/g;

function encodeRaw(html) {
  // toWellFormed: نص منسوخ قد يحمل نصف رمز (surrogate) يتيم يُسقط encodeURIComponent
  return encodeURIComponent(typeof html.toWellFormed === 'function' ? html.toWellFormed() : html);
}

function decodeRaw(encoded) {
  try {
    return decodeURIComponent(encoded);
  } catch {
    return '';
  }
}

/**
 * الكتلة المحفوظة. المحرّر يكتبها مؤقتاً كعنصر نائب ‎<div data-raw-block="…">‎ يحمل الـHTML
 * الأصلي مرمَّزاً، لأن مُسلسِل ProseMirror يبني عناصر ولا يقبل HTML خاماً. بعد التسلسل
 * يجب تمرير الناتج على expandRawBlocks() ليعود الـHTML الأصلي مكان العنصر النائب.
 */
export const RawBlock = Node.create({
  name: 'rawBlock',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  // قبل كل القواعد الأخرى، وإلا التقط StarterKit محتوى الجدول كفقرات
  priority: 1000,

  addAttributes() {
    return { html: { default: '', rendered: false } };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-raw-block]',
        getAttrs: (el) => ({ html: decodeRaw(el.getAttribute('data-raw-block') || '') }),
      },
      ...RAW_BLOCK_TAGS.map((tag) => ({ tag, getAttrs: (el) => ({ html: el.outerHTML }) })),
    ];
  },

  renderHTML({ node }) {
    return ['div', { 'data-raw-block': encodeRaw(node.attrs.html) }];
  },
});

/** يعيد الـHTML الأصلي مكان العناصر النائبة — آخر خطوة قبل حفظ content_html */
export function expandRawBlocks(html) {
  return html.replace(RAW_PLACEHOLDER, (_, encoded) => decodeRaw(encoded));
}

/**
 * الصورة: عنصر سطري (inline) لا كتلة. في تدوينات Blogger الصورة تجلس داخل رابط نسختها
 * الكبيرة ‎<a href><img></a>‎ ووسط النص؛ كعنصر سطري تحتفظ بالرابط (كعلامة link) وبمكانها
 * بلا شقّ الفقرة. شكلها ككتلة متوسّطة يأتي من ‎.post-content img‎ في global.css.
 */
export const PostImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      // النسخة المصغّرة لصور الموقع — يقرأها extractImages في scripts/lib/post-html.mjs
      thumb: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-thumb'),
        renderHTML: (attrs) => (attrs.thumb ? { 'data-thumb': attrs.thumb } : {}),
      },
      loading: {
        default: null,
        parseHTML: (el) => el.getAttribute('loading'),
        renderHTML: (attrs) => (attrs.loading ? { loading: attrs.loading } : {}),
      },
    };
  },
}).configure({ inline: true, allowBase64: false });

/**
 * علامات تنسيق النص: حجم الخط، لون النص، لون الخلفية — كل واحدة علامة مستقلة.
 *
 * لماذا ليست إضافة TextStyle الجاهزة في TipTap: تلك تجمع الخصائص في علامة واحدة، وتدمج
 * أنماط الـ<span> المتداخلة بتكرار نمط الأب داخل الابن عند كل مستوى. تدوينات Blogger
 * فيها <span> متداخلة بعمق عشرات المستويات، فيتضاعف طول النمط أُسّياً ويتجمّد المحرّر
 * (تدوينة واحدة أخذت دقيقة كاملة ثم استنفدت الذاكرة).
 *
 * هنا القراءة بقواعد ProseMirror للأنماط (style rule): تُطبَّق على أي عنصر يحمل الخاصية
 * مضمّنةً — <span> أو <div> أو غيرهما — والتداخل يعمل كما في CSS: لون داخلي يغيّر اللون
 * فقط ويبقى الحجم الخارجي.
 */
const SAFE_CSS_VALUE = /^[#a-z0-9(),.%\s-]+$/i;

function styleMark({ name, property, attribute, fontAttribute }) {
  return Mark.create({
    name,

    addAttributes() {
      return { [attribute]: { default: null, rendered: false } };
    },

    parseHTML() {
      const rules = [
        {
          style: property,
          getAttrs: (value) => (SAFE_CSS_VALUE.test(value) ? { [attribute]: value.trim() } : false),
        },
      ];
      // وسم <font color> القديم
      if (fontAttribute) {
        rules.push({
          tag: `font[${fontAttribute}]`,
          getAttrs: (el) => {
            const value = el.getAttribute(fontAttribute) || '';
            return SAFE_CSS_VALUE.test(value) ? { [attribute]: value.trim() } : false;
          },
        });
      }
      return rules;
    },

    renderHTML({ mark }) {
      return ['span', { style: `${property}: ${mark.attrs[attribute]}` }, 0];
    },
  });
}

export const FontSize = styleMark({ name: 'fontSize', property: 'font-size', attribute: 'size' });
export const TextColor = styleMark({ name: 'textColor', property: 'color', attribute: 'color', fontAttribute: 'color' });
export const Highlight = styleMark({ name: 'highlight', property: 'background-color', attribute: 'color' });

export const Superscript = Mark.create({
  name: 'superscript',
  excludes: 'subscript',
  parseHTML: () => [{ tag: 'sup' }],
  renderHTML: () => ['sup', 0],
});

export const Subscript = Mark.create({
  name: 'subscript',
  excludes: 'superscript',
  parseHTML: () => [{ tag: 'sub' }],
  renderHTML: () => ['sub', 0],
});

/**
 * سمات الفقرات والعناوين:
 * - align: التوسيط يُكتب data-align="center" لا style. محاذاة Blogger القديمة
 *   (text-align مضمّن في 301 تدوينة) يلغيها global.css عمداً، وقراءتها هنا كانت ستعيدها.
 * - dir: يُحفظ ltr فقط (فقرة إنجليزية)؛ rtl هو اتجاه الصفحة أصلاً.
 */
export const BlockAttributes = Extension.create({
  name: 'blockAttributes',
  addGlobalAttributes() {
    return [
      {
        types: ['paragraph', 'heading'],
        attributes: {
          align: {
            default: null,
            parseHTML: (el) => (el.getAttribute('data-align') === 'center' ? 'center' : null),
            renderHTML: (attrs) => (attrs.align ? { 'data-align': attrs.align } : {}),
          },
          dir: {
            default: null,
            parseHTML: (el) => ((el.getAttribute('dir') || '').toLowerCase() === 'ltr' ? 'ltr' : null),
            renderHTML: (attrs) => (attrs.dir ? { dir: attrs.dir } : {}),
          },
        },
      },
    ];
  },
});

/** أحجام الخط في شريط الأدوات — نسبية (em) لتتبع قياس الصفحة على الجوال والكمبيوتر */
export const FONT_SIZES = [
  { id: 'small', label: 'صغير', value: '0.85em' },
  { id: 'normal', label: 'عادي', value: null },
  { id: 'large', label: 'كبير', value: '1.25em' },
  { id: 'huge', label: 'كبير جداً', value: '1.6em' },
];

/** ألوان النص في شريط الأدوات — من هوية الموقع */
export const TEXT_COLORS = [
  { id: 'ink', label: 'حبر', value: null },
  { id: 'clay', label: 'طيني', value: '#c8612e' },
  { id: 'gold', label: 'ذهبي', value: '#c9a04a' },
  { id: 'olive', label: 'زيتوني', value: '#6b7d5a' },
];

export const studioExtensions = [
  StarterKit.configure({
    // لا يوجد كود في المدوّنة؛ و<pre> القديمة تُحفظ ككتلة محفوظة
    code: false,
    codeBlock: false,
    // كل المستويات تُقرأ حفاظاً على القديم؛ شريط الأدوات يعرض H2 و H3 فقط
    heading: { levels: [1, 2, 3, 4, 5, 6] },
    link: {
      openOnClick: false,
      autolink: false,
      // لا تُفرض سمات على روابط التدوينات القديمة — يبقى ما كان مكتوباً فيها
      HTMLAttributes: { target: null, rel: null, class: null },
    },
  }),
  FontSize,
  TextColor,
  Highlight,
  Superscript,
  Subscript,
  PostImage,
  RawBlock,
  BlockAttributes,
];
