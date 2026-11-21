/**
 * «الكتل المحفوظة»: وسوم لا يعرف المحرّر بنيتها الداخلية، فتُحفظ حرفياً بدل أن تُفكّ وتضيع
 * (الجدول يصير فقرات، والفيديو يختفي). دوال نصّية خالصة بلا أي اعتماد — يستوردها مخطط المحرّر
 * (schema.js) وفاحص الخادم (sanitize.ts) معاً، فلا يسحب الخادمُ مكتبة المحرّر كلها.
 */

/** تظهر في المحرّر صندوقاً يُحذف أو يُنقل ولا يُعدَّل داخله */
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

export function encodeRaw(html) {
  // toWellFormed: نص منسوخ قد يحمل نصف رمز (surrogate) يتيم يُسقط encodeURIComponent
  return encodeURIComponent(typeof html.toWellFormed === 'function' ? html.toWellFormed() : html);
}

export function decodeRaw(encoded) {
  try {
    return decodeURIComponent(encoded);
  } catch {
    return '';
  }
}

/** يعيد الـHTML الأصلي مكان العناصر النائبة ‎<div data-raw-block="…">‎ */
export function expandRawBlocks(html) {
  return html.replace(RAW_PLACEHOLDER, (_, encoded) => decodeRaw(encoded));
}

/**
 * صيغة الإرسال إلى الخادم: العناصر النائبة تحمل رقماً، ونصوص الكتل في مصفوفة بجانبها.
 * (ترميز الكتلة داخل السمة يضخّم النص العربي ثلاث مرات؛ جدول كبير قد يتجاوز حد حجم الطلب.)
 * @returns {{ html: string, raw: string[] }}
 */
export function splitRawBlocks(html) {
  const raw = [];
  return {
    html: html.replace(RAW_PLACEHOLDER, (_, encoded) => `<div data-raw-block="${raw.push(decodeRaw(encoded)) - 1}"></div>`),
    raw,
  };
}

/**
 * قيمة CSS مقبولة لحجم الخط واللون: أحرف وأرقام و‎# ( ) , . %‎ ومسافات — لا نقطتان ولا شرطة
 * مائلة ولا علامات تنصيص، فلا ‎url()‎ ولا خاصية ثانية مدسوسة. يستعملها المخطط عند القراءة
 * وفاحص الخادم عند الحفظ، ويجب أن تبقى واحدة فيهما.
 */
export const SAFE_CSS_VALUE = /^[#a-z0-9(),.%\s-]+$/i;
