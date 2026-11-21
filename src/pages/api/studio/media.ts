/**
 * رفع صورة من المحرّر.
 *
 *   POST /api/studio/media  ←  multipart: full (JPEG ≤2000px)، thumb (JPEG 480px)
 *                           →  201 { src, thumb }   عنوانا النسختين في Vercel Blob
 *
 * المتصفح يصغّر الصورة قبل الرفع (src/scripts/studio/images.ts)؛ هنا يُتحقق أنها JPEG في
 * الحدود (src/lib/studio/media.ts) ثم تُكتب.
 */

import type { APIRoute } from 'astro';
import { studioRepo } from '../../../lib/studio/config.ts';
import { requireStudio } from '../../../lib/studio/guard.ts';
import { checkImagePair, storeImagePair, studioMedia } from '../../../lib/studio/media.ts';

export const prerender = false;

/** أقل من حد جسم الطلب في دوال Vercel (4.5MB) */
const MAX_REQUEST_BYTES = 4_400_000;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });

const PROBLEMS = {
  'not-jpeg': 'هذا الملف ليس صورة يمكن رفعها.',
  'too-heavy': 'الصورة كبيرة جداً حتى بعد تصغيرها.',
  'too-wide': 'أبعاد الصورة أكبر من المسموح.',
};

export const POST: APIRoute = async ({ locals, request }) => {
  const denied = requireStudio(locals);
  if (denied) return denied;

  const repo = studioRepo();
  if (!repo) return json({ error: 'اللوحة لم تُوصَل بالمستودع بعد.' }, 503);
  const media = studioMedia(repo);
  if (!media) return json({ error: 'رفع الصور غير مفعّل بعد. أخبر عبيد.' }, 503);

  if (Number(request.headers.get('content-length') ?? 0) > MAX_REQUEST_BYTES) {
    return json({ error: PROBLEMS['too-heavy'] }, 413);
  }

  let full: Uint8Array;
  let thumb: Uint8Array;
  try {
    const form = await request.formData();
    const fullFile = form.get('full');
    const thumbFile = form.get('thumb');
    if (!(fullFile instanceof Blob) || !(thumbFile instanceof Blob)) return json({ error: 'تعذّرت قراءة الصورة.' }, 400);
    full = new Uint8Array(await fullFile.arrayBuffer());
    thumb = new Uint8Array(await thumbFile.arrayBuffer());
  } catch {
    return json({ error: 'تعذّرت قراءة الصورة.' }, 400);
  }

  const problem = checkImagePair(full, thumb);
  if (problem) return json({ error: PROBLEMS[problem], code: problem }, 422);

  try {
    return json(await storeImagePair(media, full, thumb), 201);
  } catch (err) {
    console.error('[studio] تعذّر رفع صورة إلى Blob:', err instanceof Error ? err.message : err);
    return json({ error: 'تعذّر رفع الصورة. حاول مرة أخرى بعد قليل.' }, 502);
  }
};

export const ALL: APIRoute = () => new Response('Not found', { status: 404 });
