/**
 * رابط الاقتران: ‎/studio/enter/<المفتاح>‎. الرابط الذي يُرسَل للرحّال.
 *
 * مقارنة المفتاح تتم في الحارس (src/middleware.ts) — مفتاح خاطئ لا يصل إلى هنا أصلاً.
 * هنا: كتابة كوكي الاقتران ثم التحويل إلى ‎/studio‎ النظيف، فلا يبقى المفتاح في شريط العنوان.
 */

import type { APIRoute } from 'astro';
import { pairDevice, studioKey } from '../../../lib/studio/access.ts';
import { requireStudio } from '../../../lib/studio/guard.ts';

export const prerender = false;

export const GET: APIRoute = ({ locals, cookies, redirect }) => {
  const key = studioKey();
  const denied = requireStudio(locals, 'entering');
  if (denied || !key) return denied ?? new Response('Not found', { status: 404 });

  pairDevice(cookies, key);
  return redirect('/studio', 303);
};

// أي طريقة غير GET: ردّ بجسم، وإلا جلب Astro ‎/404.html‎ من الشبكة ليملأ الردّ الفارغ
export const ALL: APIRoute = () => new Response('Not found', { status: 404 });
