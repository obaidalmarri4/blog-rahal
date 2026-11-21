/**
 * صور اللوحة في Vercel Blob (متجر عام). لكل صورة نسختان كما في ‎images[]‎: الكبيرة (≤2000px)
 * والمصغّرة (480px). المتصفح يصغّرهما قبل الرفع (src/scripts/studio/images.ts) — حد جسم الطلب في
 * دوال Vercel 4.5MB وصورة الجوال 12MB — والخادم يتحقق أنهما JPEG بأبعاد معقولة قبل أن يكتبهما.
 *
 * الصورة تُكتب فور رفعها، قبل حفظ التدوينة: المحرّر يعرضها من عنوانها النهائي، وعنوانها هو ما
 * يُخزَّن في النص. صورة رُفعت ثم لم تُحفظ تدوينتها تبقى في Blob بلا مرجع (لا تظهر في أي مكان).
 *
 * الاعتماد: BLOB_READ_WRITE_TOKEN (أو BLOB_STORE_ID مع OIDC على Vercel) — يضيفهما Vercel حين
 * يُربط متجر Blob بالمشروع. بدونهما زر الصورة يقول إن الرفع غير مفعّل.
 */

import { randomBytes } from 'node:crypto';
import { put } from '@vercel/blob';
import { getSecret } from 'astro:env/server';
import { publishesToSite } from './config.ts';
import type { RepoConfig } from './github.ts';
import { jpegSize } from './jpeg.ts';

export interface MediaConfig {
  /** null = OIDC على Vercel (BLOB_STORE_ID) */
  token: string | null;
  /** صور فرع التجربة في مجلد منفصل، فلا تختلط بصور الموقع */
  prefix: 'posts' | 'sandbox';
}

export function studioMedia(repo: RepoConfig): MediaConfig | null {
  const token = getSecret('BLOB_READ_WRITE_TOKEN')?.trim() || null;
  const storeId = getSecret('BLOB_STORE_ID')?.trim() || null;
  if (!token && !storeId) return null;
  return { token, prefix: publishesToSite(repo) ? 'posts' : 'sandbox' };
}

/** حدود ما يُقبل — المتصفح يصغّر إلى 2000px و 480px؛ الهامش لصور تُصغَّر بدقة أخرى */
export const IMAGE_LIMITS = {
  fullBytes: 3_800_000,
  thumbBytes: 400_000,
  fullSide: 2400,
  thumbSide: 640,
};

export type ImageProblem = 'not-jpeg' | 'too-heavy' | 'too-wide';

/** هل النسختان صورتا JPEG في الحدود؟ null = مقبولتان */
export function checkImagePair(full: Uint8Array, thumb: Uint8Array): ImageProblem | null {
  const fullSize = jpegSize(full);
  const thumbSize = jpegSize(thumb);
  if (!fullSize || !thumbSize) return 'not-jpeg';
  if (full.length > IMAGE_LIMITS.fullBytes || thumb.length > IMAGE_LIMITS.thumbBytes) return 'too-heavy';
  if (Math.max(fullSize.width, fullSize.height) > IMAGE_LIMITS.fullSide) return 'too-wide';
  if (Math.max(thumbSize.width, thumbSize.height) > IMAGE_LIMITS.thumbSide) return 'too-wide';
  return null;
}

/** سنة واحدة: عنوان كل صورة فريد ولا يتغيّر محتواه */
const CACHE_SECONDS = 365 * 24 * 60 * 60;

/** يكتب النسختين ويعيد عنوانيهما العامّين */
export async function storeImagePair(
  config: MediaConfig,
  full: Uint8Array,
  thumb: Uint8Array,
  now: Date = new Date()
): Promise<{ src: string; thumb: string }> {
  const month = now.toISOString().slice(0, 7).replace('-', '/');
  const base = `${config.prefix}/${month}/${randomBytes(9).toString('base64url')}`;
  const options = {
    access: 'public' as const,
    contentType: 'image/jpeg',
    addRandomSuffix: false,
    cacheControlMaxAge: CACHE_SECONDS,
    ...(config.token ? { token: config.token } : {}),
  };
  const [large, small] = await Promise.all([
    put(`${base}.jpg`, Buffer.from(full), options),
    put(`${base}-thumb.jpg`, Buffer.from(thumb), options),
  ]);
  return { src: large.url, thumb: small.url };
}
