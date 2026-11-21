/**
 * تجهيز صورة من الجوال للرفع: نسخة كبيرة (≤2000px) ونسخة مصغّرة (480px)، كلتاهما JPEG.
 *
 * صورة الجوال قد تبلغ 12MB، وحد جسم الطلب في دوال Vercel 4.5MB؛ والتصغير هنا يجعل الصورة
 * بحجم يناسب صفحة ويب أصلاً. المتصفح يطبّق اتجاه الصورة (EXIF) حين يرسمها، فتصل معتدلة.
 * الخادم يعيد التحقق من الحجم والأبعاد (src/lib/studio/media.ts).
 */

const FULL_SIDE = 2000;
const THUMB_SIDE = 480;
const FULL_MAX_BYTES = 3_500_000;
const THUMB_MAX_BYTES = 380_000;
const LOAD_TIMEOUT_MS = 30_000;

export class ImageError extends Error {}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
}

async function scaled(image: HTMLImageElement, side: number, qualities: number[], maxBytes: number): Promise<Blob> {
  const scale = Math.min(1, side / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new ImageError('تعذّر تجهيز الصورة في هذا المتصفح.');
  // الشفافية (PNG) تصير خلفية بيضاء بدل السوداء
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, 0, 0, width, height);
  for (const quality of qualities) {
    const blob = await toBlob(canvas, quality);
    if (blob && blob.size <= maxBytes) return blob;
  }
  throw new ImageError('الصورة كبيرة جداً حتى بعد تصغيرها.');
}

export async function prepareImage(file: File): Promise<{ full: Blob; thumb: Blob }> {
  if (file.type && !file.type.startsWith('image/')) throw new ImageError(`«${file.name}» ليس صورة.`);
  const url = URL.createObjectURL(file);
  try {
    // حدث load لا image.decode(): في صفحة تحمّل عشرات الصور (تدوينة قديمة) قد لا يُحسم وعد decode()
    // أبداً في Chrome، فيعلق الرفع. الرسم على اللوحة يفكّ الصورة على أي حال.
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      const timer = window.setTimeout(() => reject(new Error('timeout')), LOAD_TIMEOUT_MS);
      element.onload = () => {
        window.clearTimeout(timer);
        resolve(element);
      };
      element.onerror = () => {
        window.clearTimeout(timer);
        reject(new Error('unreadable'));
      };
      element.src = url;
    }).catch(() => {
      throw new ImageError(`صيغة «${file.name}» لا تُقرأ في هذا المتصفح. جرّب صورة JPG.`);
    });
    if (!image.naturalWidth || !image.naturalHeight) throw new ImageError(`«${file.name}» صورة فارغة.`);
    const full = await scaled(image, FULL_SIDE, [0.85, 0.75, 0.65], FULL_MAX_BYTES);
    const thumb = await scaled(image, THUMB_SIDE, [0.8, 0.65], THUMB_MAX_BYTES);
    return { full, thumb };
  } finally {
    URL.revokeObjectURL(url);
  }
}
