/**
 * إلغاء اقتران هذا الجهاز: تُحذف الكوكي منه فلا تُفتح اللوحة حتى يُضغط رابط الاقتران من جديد.
 *
 * (الحذف من هذا المتصفح فقط. إبطال كل الأجهزة دفعة واحدة = تغيير STUDIO_KEY.)
 */

import type { APIRoute } from 'astro';
import { unpairDevice } from '../../../lib/studio/access.ts';
import { requireStudio } from '../../../lib/studio/guard.ts';

export const prerender = false;

export const POST: APIRoute = ({ locals, cookies, redirect }) => {
  const denied = requireStudio(locals);
  if (denied) return denied;

  unpairDevice(cookies);
  return redirect('/', 303);
};

// أي طريقة غير POST: ردّ بجسم، وإلا جلب Astro ‎/404.html‎ من الشبكة ليملأ الردّ الفارغ
export const ALL: APIRoute = () => new Response('Not found', { status: 404 });
