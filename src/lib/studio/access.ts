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

let warned = false;

/**
 * المفتاح السرّي إن كانت اللوحة مفعّلة هنا، وإلا null (فتردّ اللوحة 404 على كل شيء).
 *
 * المسافات حول القيمة تُحذف: لصق المفتاح في لوحة Vercel قد يحمل معه سطراً جديداً، وبدونه يُرفض
 * المفتاح بصمت. وإن بقي المفتاح غير صالح يُكتب سطر واحد في سجلّ الخادم (Vercel ← Logs) — لا يراه
 * الزائر، فالردّ يبقى 404 كأي عنوان خاطئ.
 */
export function studioKey(): string | null {
  const environment = getSecret('VERCEL_ENV');
  if (!ALLOWED_VERCEL_ENVS.includes(environment)) return null;
  const key = getSecret('STUDIO_KEY')?.trim();
  if (isUsableKey(key)) return key;
  if (!warned && (key || environment === 'production')) {
    warned = true;
    console.warn(
      key
        ? '[studio] STUDIO_KEY غير صالح (يلزم 32 حرفاً على الأقل من A-Z a-z 0-9 - _ فقط): اللوحة مغلقة.'
        : '[studio] STUDIO_KEY غير مضبوط في هذا النشر: اللوحة مغلقة.'
    );
  }
  return null;
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
