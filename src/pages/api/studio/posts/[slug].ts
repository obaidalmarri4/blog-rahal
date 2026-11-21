/**
 * نص التدوينة للمحرّر.
 *
 *   GET /api/studio/posts/<slug>  →  { title, html, base, locked }
 *   PUT /api/studio/posts/<slug>  ←  { html, raw, base }   (html بالعناصر النائبة المرقّمة)
 *                                 →  { commit, base, live } | { unchanged: true } | { error }
 *
 * `base` بصمة النص عند الفتح: إن تغيّر النص في المستودع قبل الحفظ يُرفض الحفظ (409) بدل أن
 * يُكتب فوق تعديل لم يره الكاتب.
 */

import type { APIRoute } from 'astro';
import { publishesToSite, studioRepo } from '../../../../lib/studio/config.ts';
import { describeFailure } from '../../../../lib/studio/failure.ts';
import { requireStudio } from '../../../../lib/studio/guard.ts';
import { getPostBody, updatePostBody } from '../../../../lib/studio/store.ts';

export const prerender = false;

/** أكبر طلب حفظ في الأرشيف 340KB؛ حد جسم الطلب في دوال Vercel 4.5MB */
const MAX_REQUEST_BYTES = 4_000_000;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });

export const GET: APIRoute = async ({ locals, params }) => {
  const denied = requireStudio(locals);
  if (denied) return denied;

  const repo = studioRepo();
  if (!repo) return json({ error: 'اللوحة لم تُوصَل بالمستودع بعد.' }, 503);

  try {
    const body = await getPostBody(repo, params.slug ?? '');
    return body ? json(body) : json({ error: 'هذه التدوينة غير موجودة.' }, 404);
  } catch (err) {
    return json({ error: describeFailure(err).message }, 502);
  }
};

export const PUT: APIRoute = async ({ locals, params, request }) => {
  const denied = requireStudio(locals);
  if (denied) return denied;

  const repo = studioRepo();
  if (!repo) return json({ error: 'اللوحة لم تُوصَل بالمستودع بعد.' }, 503);

  let input: { html?: unknown; raw?: unknown; base?: unknown };
  try {
    const text = await request.text();
    if (text.length > MAX_REQUEST_BYTES) return json({ error: 'النص أكبر من أن يُحفظ من اللوحة.' }, 413);
    input = JSON.parse(text);
  } catch {
    return json({ error: 'تعذّرت قراءة الطلب.' }, 400);
  }
  if (typeof input.html !== 'string' || typeof input.base !== 'string' || !Array.isArray(input.raw)) {
    return json({ error: 'تعذّرت قراءة الطلب.' }, 400);
  }

  try {
    const result = await updatePostBody(repo, params.slug ?? '', {
      html: input.html,
      raw: input.raw as string[],
      base: input.base,
    });
    switch (result.kind) {
      case 'saved':
        return json({ commit: result.commit, base: result.base, live: publishesToSite(repo) });
      case 'unchanged':
        return json({ unchanged: true });
      case 'missing':
        return json({ error: 'هذه التدوينة غير موجودة. ربما حُذفت.' }, 404);
      case 'conflict':
        return json({ error: 'نص التدوينة تغيّر من جهاز آخر بعد أن فتحتها. تعديلاتك محفوظة على هذا الجهاز: حدّث الصفحة ثم استرجعها.' }, 409);
      case 'locked':
        return json({ error: 'هذه التدوينة أكبر من أن تُحرَّر من اللوحة.' }, 422);
      case 'rejected':
        return json(
          {
            error:
              result.reason === 'raw:unknown'
                ? 'في النص جدول أو مقطع لم يكن في هذه التدوينة، ولا يُضاف من هنا. احذفه ثم احفظ.'
                : 'في النص محتوى لا يُحفظ من اللوحة. تراجع عن آخر لصق ثم احفظ، وإن تكرّر أخبر عبيد.',
            code: result.reason,
          },
          422
        );
    }
  } catch (err) {
    return json({ error: describeFailure(err).message }, 502);
  }
};

export const ALL: APIRoute = () => new Response('Not found', { status: 404 });
