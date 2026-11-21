/**
 * دوال HTML المشتركة لاشتقاق حقول التدوينة (slug، content_text، images[]).
 *
 * مصدر واحد يستعمله سكربت المزامنة (scripts/sync-blogger.mjs) ولوحة التحرير (/studio)
 * حتى لا يختلف شكل الملفات باختلاف من كتبها. ملف JavaScript صِرف بلا اعتماديات ليُستورد
 * من Node ومن Astro معاً — لا تكرّر هذه الدوال في مكان آخر.
 */

/** نفس منطق getPostSlug في src/utils/posts.ts */
export function cleanSlug(slug) {
  return slug.replace(/\.html$/, '').replace(/\//g, '-');
}

/** يحوّل رابط تدوينة كامل إلى slug: /2026/07/blog-post.html → 2026-07-blog-post */
export function slugFromUrl(url) {
  return cleanSlug(url.replace(/^https?:\/\/[^/]+\//, ''));
}

export function decodeEntities(s) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return s
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => (n.toLowerCase() in named ? named[n.toLowerCase()] : m));
}

/** استخراج نص مقروء من HTML التدوينة — الفواصل بين الكتل تصبح أسطراً */
export function htmlToText(html) {
  return decodeEntities(
    html
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|h[1-6]|li|tr|blockquote)>/gi, '\n')
      .replace(/<[^>]+>/g, '')
  )
    // \u00a0 = المسافة غير القابلة للكسر التي يلصقها محرّر Blogger بين الكلمات
    .replace(/[ \t\u00a0]+/g, ' ')
    .split('\n')
    .map((l) => l.trim())
    .filter((l, i, a) => l !== '' || (i > 0 && a[i - 1] !== ''))
    .join('\n')
    .trim();
}

/** صور مستضافة على Blogger/Google */
const BLOGGER_IMAGE = /googleusercontent|blogspot|ggpht/;

/**
 * صور الموقع نفسه: ما رُفع من لوحة التحرير إلى Vercel Blob، وما استُخرج إلى public/media.
 * هذه لا يحمل رابطها مقاساً كصور Blogger، فالمصغّرة تأتي من السمة data-thumb إن وُجدت.
 */
export function isSiteImage(url) {
  return /^\/media\//.test(url) || /^https:\/\/[^/]+\.blob\.vercel-storage\.com\//.test(url);
}

function attr(tagAttrs, name) {
  const m = new RegExp(`\\b${name}=["']([^"']*)["']`, 'i').exec(tagAttrs);
  return m ? decodeEntities(m[1]) : '';
}

/**
 * صور التدوينة بترتيب ورودها.
 * - صور Blogger: الرابط الملفوف = النسخة الكبيرة، وسمة src = المصغّرة.
 * - صور الموقع: src = النسخة الكبيرة، و data-thumb = المصغّرة.
 * أي صورة من مصدر آخر (أيقونات، بكسلات تتبّع، مواقع خارجية) تُهمل.
 */
export function extractImages(bodyHtml) {
  const images = [];
  const seen = new Set();

  const wrapped = /<a[^>]+href=["']([^"']*(?:googleusercontent|blogspot)[^"']*)["'][^>]*>\s*<img([^>]*)>/gi;
  let m;
  while ((m = wrapped.exec(bodyHtml)) !== null) {
    const src = /src=["']([^"']+)["']/i.exec(m[2]);
    if (!src) continue;
    const original = decodeEntities(m[1]);
    if (seen.has(original)) continue;
    seen.add(original);
    seen.add(decodeEntities(src[1]));
    images.push({
      original_url: original,
      thumbnail_url: decodeEntities(src[1]),
      alt: decodeEntities((/alt=["']([^"']*)["']/i.exec(m[2]) || ['', ''])[1]),
      local_path: '',
    });
  }

  // صور غير ملفوفة برابط
  const bare = /<img([^>]*)>/gi;
  while ((m = bare.exec(bodyHtml)) !== null) {
    const src = /src=["']([^"']+)["']/i.exec(m[1]);
    if (!src) continue;
    const url = decodeEntities(src[1]);
    const own = isSiteImage(url);
    if (seen.has(url) || !(own || BLOGGER_IMAGE.test(url))) continue;
    seen.add(url);
    images.push({
      original_url: url,
      thumbnail_url: (own && attr(m[1], 'data-thumb')) || url,
      alt: decodeEntities((/alt=["']([^"']*)["']/i.exec(m[1]) || ['', ''])[1]),
      local_path: '',
    });
  }

  return images;
}

/**
 * عناوين الصور المعروضة في الجسم (سمة src فقط). رابط يلفّ صورة ليس صورة: لو حُذفت الصورة
 * وبقي الرابط حول نص بجوارها، فالصورة لم تعد في التدوينة.
 */
function imageSourcesIn(html) {
  const urls = new Set();
  for (const m of html.matchAll(/<img\b[^>]*?\bsrc=["']([^"']+)["']/gi)) urls.add(decodeEntities(m[1]));
  return urls;
}

/**
 * قائمة ‎images[]‎ بعد تعديل الجسم من لوحة التحرير، بأقل تغيير ممكن:
 *   - صورة حُذفت من الجسم تُحذف من القائمة.
 *   - صورة أُضيفت للجسم تُضاف في آخرها.
 *   - ما عدا ذلك يبقى كما هو حرفاً بحرف (ومنه ‎local_path‎ الذي لا يُشتق من الـHTML).
 * قوائم الأرشيف جمعها الساحب الأصلي بقواعد لا تطابق extractImages تماماً، فإعادة اشتقاقها
 * كاملةً تغيّر قائمة تدوينة لم يلمس أحد صورها. مدخل لا تظهر صورته في الجسم القديم أصلاً
 * (لا ‎<img>‎ بعنوانه) لا يُعرف مصيره، فيبقى.
 */
export function reconcileImages(oldImages, oldHtml, newHtml) {
  const before = imageSourcesIn(oldHtml);
  const after = imageSourcesIn(newHtml);
  const inside = (urls, image) => urls.has(image.original_url) || urls.has(image.thumbnail_url);

  const kept = (oldImages ?? []).filter((image) => !inside(before, image) || inside(after, image));

  const known = new Set(extractImages(oldHtml).map((image) => image.original_url));
  for (const image of kept) known.add(image.original_url).add(image.thumbnail_url);
  const added = extractImages(newHtml).filter((image) => !known.has(image.original_url) && !known.has(image.thumbnail_url));

  return [...kept, ...added];
}

/**
 * يكتب التدوينة بنفس تنسيق الملفات الحالية (مسافتان) ويحافظ على وجود السطر الأخير أو
 * غيابه كما في الملف الأصلي — 398 ملفاً قديماً بلا سطر أخير، وملفات المزامنة به —
 * حتى لا يظهر في Git فرق لا علاقة له بالتعديل.
 */
export function serializePost(post, previousRaw) {
  const trailingNewline = previousRaw === undefined || previousRaw.endsWith('\n');
  return JSON.stringify(post, null, 2) + (trailingNewline ? '\n' : '');
}
