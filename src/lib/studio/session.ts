/**
 * اقتران الأجهزة بلوحة التحرير: مقارنة المفتاح السرّي، وتوقيع كوكي الاقتران والتحقق منها.
 *
 * لا توجد قاعدة بيانات ولا قائمة أجهزة. الكوكي تحمل تاريخ انتهائها وتوقيعاً (HMAC) مشتقاً
 * من `STUDIO_KEY` نفسه، فينتج عن ذلك:
 *   - تغيير المفتاح يُبطل كل الأجهزة المقترنة والرابط القديم معاً، فوراً.
 *   - لا يمكن تمديد كوكي أو تزويرها بلا معرفة المفتاح.
 *
 * دوال خالصة (المفتاح والوقت يُمرَّران لها) ليستوردها Node مباشرة في
 * scripts/studio-access-check.mjs — لذلك لا يلمس هذا الملف `astro:*` ولا `import.meta.env`.
 */

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const COOKIE_NAME = 'rk_studio';

/** مدة الاقتران: سنة */
export const SESSION_SECONDS = 365 * 24 * 60 * 60;

/** تُجدَّد الكوكي إن مضى على إصدارها شهر، فمن يستعمل اللوحة لا ينتهي اقترانه أبداً */
const RENEW_AFTER_SECONDS = 30 * 24 * 60 * 60;

/** المفتاح جزء من رابط: أحرف آمنة في العناوين فقط، و32 حرفاً على الأقل (192 بت) */
const KEY_PATTERN = /^[A-Za-z0-9_-]{32,}$/;

const TOKEN_VERSION = 'v1';

export interface Session {
  /** وقت الانتهاء بالثواني (Unix) */
  expires: number;
  /** حان وقت إصدار كوكي جديدة */
  renew: boolean;
}

/** مفتاح فارغ أو قصير يعني أن اللوحة غير مفعّلة — لا يُقبل «أي شيء» مفتاحاً */
export function isUsableKey(key: unknown): key is string {
  return typeof key === 'string' && KEY_PATTERN.test(key);
}

/** مقارنة بزمن ثابت. التجزئة أولاً توحّد الطول، فلا يتسرّب طول المفتاح من زمن المقارنة */
export function keysMatch(candidate: string, key: string): boolean {
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(candidate), digest(key));
}

function sign(payload: string, key: string): Buffer {
  // مفتاح فرعي للكوكي: لا يُستعمل STUDIO_KEY نفسه مفتاحَ توقيع مباشرة
  const cookieKey = createHmac('sha256', key).update('rahal-studio/cookie/v1').digest();
  return createHmac('sha256', cookieKey).update(payload).digest();
}

/** قيمة كوكي الاقتران: ‎v1.<وقت الانتهاء>.<التوقيع>‎ */
export function issueSession(key: string, nowMs: number = Date.now()): string {
  const payload = `${TOKEN_VERSION}.${Math.floor(nowMs / 1000) + SESSION_SECONDS}`;
  return `${payload}.${sign(payload, key).toString('base64url')}`;
}

/** يعيد الجلسة إن كانت الكوكي موقّعة بالمفتاح الحالي وغير منتهية، وإلا null */
export function readSession(
  token: string | undefined,
  key: string,
  nowMs: number = Date.now()
): Session | null {
  if (!token || token.length > 128) return null;

  const [version, expiresText, signatureText, ...extra] = token.split('.');
  if (version !== TOKEN_VERSION || extra.length > 0) return null;
  if (!expiresText || !signatureText || !/^\d{1,12}$/.test(expiresText)) return null;

  const given = Buffer.from(signatureText, 'base64url');
  const expected = sign(`${version}.${expiresText}`, key);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

  const now = Math.floor(nowMs / 1000);
  const expires = Number(expiresText);
  if (expires <= now) return null;

  return { expires, renew: expires - now < SESSION_SECONDS - RENEW_AFTER_SECONDS };
}
