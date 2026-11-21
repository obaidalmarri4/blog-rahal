/**
 * أبعاد صورة JPEG من ترويستها (علامة SOF) بلا فكّ الصورة نفسها. يستعملها الخادم ليتحقق أن ما
 * رفعه المتصفح صورة JPEG بالحجم الذي صغّرها إليه، قبل أن يكتبها في Blob. دالة خالصة.
 */

export interface JpegSize {
  width: number;
  height: number;
}

/** null إن لم تبدأ الملف ترويسة JPEG سليمة، أو لم توجد علامة SOF قبل بيانات الصورة */
export function jpegSize(bytes: Uint8Array): JpegSize | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return null;

  let i = 2;
  while (i + 8 < bytes.length) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1];
    // حشو بين العلامات
    if (marker === 0xff) {
      i += 1;
      continue;
    }
    // علامات بلا طول
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      i += 2;
      continue;
    }
    // نهاية الصورة أو بداية بياناتها قبل أي SOF: ليست صورة يُعرف حجمها
    if (marker === 0xd9 || marker === 0xda) return null;

    const length = (bytes[i + 2] << 8) | bytes[i + 3];
    if (length < 2) return null;

    // SOF0..SOF15 ما عدا DHT (C4) و JPG (C8) و DAC (CC)
    const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrame) {
      const height = (bytes[i + 5] << 8) | bytes[i + 6];
      const width = (bytes[i + 7] << 8) | bytes[i + 8];
      return width > 0 && height > 0 ? { width, height } : null;
    }
    i += 2 + length;
  }
  return null;
}
