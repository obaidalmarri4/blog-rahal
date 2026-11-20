/**
 * ربط جلسة اللوحة (session.ts) ببيئة التشغيل: من أين يأتي المفتاح، وكيف تُكتب الكوكي.
 */

import type { AstroCookies } from 'astro';
import { getSecret } from 'astro:env/server';
import { COOKIE_NAME, SESSION_SECONDS, isUsableKey, issueSession } from './session.ts';

/**
 * البيئات التي تعمل فيها اللوحة. على Vercel: الإنتاج فقط — روابط المعاينة (Preview) لكل
 * فرع عامة، ولو عملت اللوحة فيها لصار كل فرع تجريبي باباً خلفياً. خارج Vercel
 * (`astro dev` على جهاز المطوّر) المتغيّر غير موجود أصلاً.
 */
const ALLOWED_VERCEL_ENVS = [undefined, '', 'production', 'development'];

/** المفتاح السرّي إن كانت اللوحة مفعّلة هنا، وإلا null (فتردّ اللوحة 404 على كل شيء) */
export function studioKey(): string | null {
  if (!ALLOWED_VERCEL_ENVS.includes(getSecret('VERCEL_ENV'))) return null;
  const key = getSecret('STUDIO_KEY');
  return isUsableKey(key) ? key : null;
}

/** يكتب كوكي الاقتران (أو يجدّدها) */
export function pairDevice(cookies: AstroCookies, key: string): void {
  cookies.set(COOKIE_NAME, issueSession(key), {
    path: '/',
    httpOnly: true,
    // `astro dev` يعمل على http؛ في أي بناء حقيقي الكوكي لا تسافر إلا على https
    secure: !import.meta.env.DEV,
    sameSite: 'lax',
    maxAge: SESSION_SECONDS,
  });
}

export function unpairDevice(cookies: AstroCookies): void {
  cookies.delete(COOKIE_NAME, { path: '/' });
}
