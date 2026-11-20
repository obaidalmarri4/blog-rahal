/**
 * رسالة للمستخدم عند فشل الاتصال بالمستودع. الرحّال يرى جملة واضحة وما يفعله؛ والتفصيل
 * التقني سطر صغير تحتها للمطوّر. لا يظهر التوكن ولا نص الخطأ الخام من GitHub.
 */

import { GitHubError } from './github.ts';

export interface Failure {
  message: string;
  detail: string;
}

export function describeFailure(err: unknown): Failure {
  if (err instanceof GitHubError) {
    if (err.code === 'busy') {
      return { message: 'المستودع مشغول الآن. انتظر لحظة ثم حاول مرة أخرى.', detail: 'busy' };
    }
    if (err.code === 'network') {
      return { message: 'تعذّر الاتصال بالمستودع. حاول بعد قليل.', detail: 'network' };
    }
    if (err.code === 'no_branch') {
      return { message: 'اللوحة غير موصولة بالمستودع كما يجب. أخبر عبيد.', detail: 'الفرع غير موجود' };
    }
    if (err.status === 401 || err.status === 403) {
      return { message: 'اللوحة غير موصولة بالمستودع كما يجب. أخبر عبيد.', detail: `التوكن مرفوض (${err.status})` };
    }
    return { message: 'حدث خطأ في المستودع. حاول بعد قليل، وإن تكرّر أخبر عبيد.', detail: `${err.code}${err.status ? ` ${err.status}` : ''}` };
  }
  return { message: 'حدث خطأ غير متوقع. حاول بعد قليل، وإن تكرّر أخبر عبيد.', detail: 'unexpected' };
}

const AR_DATE = new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  timeZone: 'UTC',
});

/** تاريخ التدوينة للعرض — اليوم المكتوب في الملف نفسه، بلا تحويل توقيت */
export function displayDate(date: string): string {
  const day = date.slice(0, 10);
  const time = Date.parse(`${day}T12:00:00Z`);
  return Number.isNaN(time) ? day : AR_DATE.format(time);
}
