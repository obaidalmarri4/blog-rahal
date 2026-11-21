/**
 * نشر تدوينة جديدة من ‎/studio/new‎.
 *
 *   POST /api/studio/posts  ←  { id, title, date, labels[], classification, html, raw }
 *                           →  201 { slug, commit, live }
 *                              409 { slug, exists: true }      (نُشرت من قبل بهذا المعرّف)
 *                              422 { errors } | { error, code }
 *
 * `id` يولّده المتصفح مرة لكل تدوينة ويحفظه مع مسودتها: إن وصل الطلب مرتين (ضغطتان، أو إعادة
 * بعد انقطاع الشبكة) لا تُنشر التدوينة مرتين.
 */

import type { APIRoute } from 'astro';
import { publishesToSite, studioRepo } from '../../../../lib/studio/config.ts';
import { describeFailure } from '../../../../lib/studio/failure.ts';
import { requireStudio } from '../../../../lib/studio/guard.ts';
import { NEW_POST_ID, createPost } from '../../../../lib/studio/store.ts';
import type { Classification } from '../../../../lib/studio/taxonomy.ts';
import { parseLabels } from '../../../../lib/studio/validate.ts';

export const prerender = false;

const MAX_REQUEST_BYTES = 4_000_000;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []);

function readClassification(value: unknown): Classification {
  const input = (value ?? {}) as { type?: unknown; countries?: unknown; category?: unknown };
  if (input.type === 'travel') return { type: 'travel', countries: [...new Set(strings(input.countries).filter(Boolean))] };
  if (input.type === 'other') return { type: 'other', category: typeof input.category === 'string' ? input.category : '' };
  return { type: 'none' };
}

export const POST: APIRoute = async ({ locals, request }) => {
  const denied = requireStudio(locals);
  if (denied) return denied;

  const repo = studioRepo();
  if (!repo) return json({ error: 'اللوحة لم تُوصَل بالمستودع بعد.' }, 503);

  let input: Record<string, unknown>;
  try {
    const text = await request.text();
    if (text.length > MAX_REQUEST_BYTES) return json({ error: 'التدوينة أكبر من أن تُنشر من اللوحة.' }, 413);
    input = JSON.parse(text);
  } catch {
    return json({ error: 'تعذّرت قراءة الطلب.' }, 400);
  }
  if (
    typeof input.id !== 'string' ||
    !NEW_POST_ID.test(input.id) ||
    typeof input.title !== 'string' ||
    typeof input.date !== 'string' ||
    typeof input.html !== 'string' ||
    !Array.isArray(input.raw)
  ) {
    return json({ error: 'تعذّرت قراءة الطلب.' }, 400);
  }

  try {
    const result = await createPost(repo, {
      id: input.id,
      meta: {
        title: input.title,
        date: input.date,
        labels: parseLabels(strings(input.labels).join('\n')),
        classification: readClassification(input.classification),
      },
      html: input.html,
      raw: input.raw as string[],
    });
    switch (result.kind) {
      case 'created':
        return json({ slug: result.slug, commit: result.commit, live: publishesToSite(repo) }, 201);
      case 'exists':
        return json({ slug: result.slug, exists: true, error: 'نُشرت هذه التدوينة من قبل.' }, 409);
      case 'invalid':
        return json({ errors: result.errors }, 422);
      case 'rejected':
        return json(
          {
            error:
              result.reason === 'raw:unknown'
                ? 'في النص جدول أو مقطع لا يُضاف من هنا. احذفه ثم انشر.'
                : 'في النص محتوى لا يُنشر من اللوحة. تراجع عن آخر لصق ثم انشر، وإن تكرّر أخبر عبيد.',
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
