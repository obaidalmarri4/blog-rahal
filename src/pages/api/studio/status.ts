/**
 * حالة نشر commit كتبته اللوحة: ‎GET /api/studio/status?sha=<40 حرفاً>‎
 * يردّ ‎{ state: 'pending' | 'success' | 'failure' | 'unknown' }‎ — يقرؤها شريط «تم الحفظ».
 */

import type { APIRoute } from 'astro';
import { studioRepo } from '../../../lib/studio/config.ts';
import { deployState } from '../../../lib/studio/github.ts';
import { requireStudio } from '../../../lib/studio/guard.ts';

export const prerender = false;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });

export const GET: APIRoute = async ({ locals, url }) => {
  const denied = requireStudio(locals);
  if (denied) return denied;

  const sha = url.searchParams.get('sha') ?? '';
  if (!/^[0-9a-f]{40}$/.test(sha)) return json({ error: 'bad sha' }, 400);

  const repo = studioRepo();
  if (!repo) return json({ state: 'unknown' });

  try {
    const { state } = await deployState(repo, sha);
    return json({ state });
  } catch {
    // فشل عابر في السؤال ليس فشلاً في النشر: الشريط يسأل من جديد
    return json({ state: 'unknown' });
  }
};

export const ALL: APIRoute = () => new Response('Not found', { status: 404 });
