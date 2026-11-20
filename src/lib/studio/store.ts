/**
 * عمليات اللوحة على التدوينات: القائمة، تعديل البيانات، الحذف.
 *
 * كل عملية كتابة تتبع النمط نفسه: اقرأ حالة الفرع عند commit بعينه ← طبّق التغيير على ما
 * قُرئ ← اكتب commit واحداً يشترط أن الفرع ما زال هناك. إن تحرّك الفرع تُعاد المحاولة من
 * القراءة. فلا يضيع تعديل تزامن مع بوت المزامنة أو مع جهاز آخر.
 */

import buildIndex from 'virtual:studio-index';
import { serializePost } from '../../../scripts/lib/post-html.mjs';
import { PATHS } from './config.ts';
import { GitHubError, StaleHeadError, createCommit, readFile, readSnapshot } from './github.ts';
import type { FileAddition, RepoConfig, Snapshot } from './github.ts';
import { summarizePost } from './summary.js';
import {
  applyClassification,
  classificationOf,
  classificationProblem,
  parseTaxonomy,
  serializeTaxonomy,
} from './taxonomy.ts';
import type { Classification, Taxonomy } from './taxonomy.ts';
import { validateChange } from './validate.ts';
import type { FieldErrors, MetaChange } from './validate.ts';

export interface PostSummary {
  file: string;
  oid: string;
  slug: string;
  title: string;
  /** كما في الملف: ‎2025-12-01T10:00:00+03:00‎ */
  date: string;
  labels: string[];
  imageCount: number;
  cover: string | null;
  url: string;
}

export interface ListedPost extends PostSummary {
  classification: Classification;
}

export interface Listing {
  head: string;
  posts: ListedPost[];
  taxonomy: Taxonomy;
}

export interface RemovedPost {
  slug: string;
  title: string;
  date: string;
  url: string;
  file: string;
  removed_at: string;
  /** الـcommit السابق للحذف — منه تُسترجع التدوينة */
  removed_from: string;
}

export type SaveResult =
  | { kind: 'saved'; commit: string }
  | { kind: 'unchanged' }
  | { kind: 'missing' }
  | { kind: 'invalid'; errors: FieldErrors };

export type DeleteResult =
  | { kind: 'deleted'; commit: string; title: string }
  | { kind: 'missing' }
  | { kind: 'brake'; minutes: number };

/** أكثر من هذا العدد من الحذوفات في ساعة يُرفض: رابط متسرّب لا يمسح الأرشيف دفعة واحدة */
export const MAX_DELETES_PER_HOUR = 5;
const HOUR_MS = 60 * 60 * 1000;
const MAX_ATTEMPTS = 4;
const FETCH_BATCH = 6;

const indexByFile = new Map<string, PostSummary>(buildIndex.map((entry) => [entry.file, entry]));

/**
 * ملخّصات كل التدوينات على الفرع. ما طابق معرّفُه فهرسَ البناء يؤخذ منه بلا أي طلب؛
 * وما تغيّر بعد البناء أو أُضيف يُجلب ملفه.
 */
async function summarize(repo: RepoConfig, snapshot: Snapshot): Promise<PostSummary[]> {
  const entries = snapshot.posts.filter((entry) => entry.name.endsWith('.json'));
  const changed = entries.filter((entry) => indexByFile.get(entry.name)?.oid !== entry.oid);

  const fresh = new Map<string, PostSummary>();
  for (let i = 0; i < changed.length; i += FETCH_BATCH) {
    await Promise.all(
      changed.slice(i, i + FETCH_BATCH).map(async (entry) => {
        const raw = await readFile(repo, `${PATHS.posts}/${entry.name}`, snapshot.head);
        try {
          fresh.set(entry.name, summarizePost(JSON.parse(raw), entry.name, entry.oid));
        } catch {
          // ملف ليس JSON صالحاً: لا يظهر في القائمة (والموقع نفسه لن يبنيه)
        }
      })
    );
  }

  const summaries: PostSummary[] = [];
  for (const entry of entries) {
    const summary = fresh.get(entry.name) ?? (changed.includes(entry) ? undefined : indexByFile.get(entry.name));
    if (summary) summaries.push(summary);
  }
  return summaries;
}

/** عند تكرار الـslug يبني Astro آخر ملف أبجدياً — فهو التدوينة التي يراها الزائر */
function findBySlug(summaries: PostSummary[], slug: string): PostSummary | undefined {
  return summaries.filter((summary) => summary.slug === slug).sort((a, b) => a.file.localeCompare(b.file)).at(-1);
}

function byNewest(a: PostSummary, b: PostSummary): number {
  return (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0) || b.file.localeCompare(a.file);
}

async function retryOnMove<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await operation();
    } catch (err) {
      if (!(err instanceof StaleHeadError)) throw err;
      if (attempt >= MAX_ATTEMPTS) throw new GitHubError('busy', `branch kept moving after ${attempt} attempts`);
    }
  }
}

function parseRemoved(raw: string | null): { posts: RemovedPost[] } {
  if (!raw) return { posts: [] };
  const parsed = JSON.parse(raw) as { posts?: RemovedPost[] };
  return { posts: Array.isArray(parsed.posts) ? parsed.posts : [] };
}

/** عنوان مختصر لسطر الـcommit */
function inHeadline(title: string): string {
  const clean = title.replace(/\s+/g, ' ').trim();
  return clean.length > 60 ? `${clean.slice(0, 59)}…` : clean;
}

// ── القراءة ─────────────────────────────────────────────────────────────────

export async function listPosts(repo: RepoConfig): Promise<Listing> {
  const snapshot = await readSnapshot(repo, PATHS);
  const taxonomy = parseTaxonomy(snapshot.taxonomyRaw);
  const posts = (await summarize(repo, snapshot))
    .sort(byNewest)
    .map((summary) => ({ ...summary, classification: classificationOf(taxonomy, summary.slug) }));
  return { head: snapshot.head, posts, taxonomy };
}

export async function getPost(repo: RepoConfig, slug: string): Promise<{ post: ListedPost; taxonomy: Taxonomy } | null> {
  const snapshot = await readSnapshot(repo, PATHS);
  const summary = findBySlug(await summarize(repo, snapshot), slug);
  if (!summary) return null;
  const taxonomy = parseTaxonomy(snapshot.taxonomyRaw);
  return { post: { ...summary, classification: classificationOf(taxonomy, slug) }, taxonomy };
}

// ── الكتابة ─────────────────────────────────────────────────────────────────

/** يطبّق الحقول المتغيّرة فقط على العنوان والتاريخ والوسوم (في ملف التدوينة) والتصنيف (في taxonomy.json) */
export async function updatePostMeta(repo: RepoConfig, slug: string, change: MetaChange): Promise<SaveResult> {
  const errors = validateChange(change);
  if (Object.keys(errors).length > 0) return { kind: 'invalid', errors };
  if (Object.keys(change).length === 0) return { kind: 'unchanged' };

  return retryOnMove<SaveResult>(async () => {
    const snapshot = await readSnapshot(repo, PATHS);
    const summary = findBySlug(await summarize(repo, snapshot), slug);
    if (!summary) return { kind: 'missing' };

    const additions: FileAddition[] = [];

    // ملف التدوينة: يُقرأ كاملاً ويُعاد بتنسيقه نفسه، وما عدا الحقول الثلاثة لا يُمسّ
    const path = `${PATHS.posts}/${summary.file}`;
    const raw = await readFile(repo, path, snapshot.head);
    const post = JSON.parse(raw) as Record<string, unknown>;
    if (change.title !== undefined) post.title = change.title;
    if (change.date !== undefined && String(post.date).slice(0, 10) !== change.date) {
      // يتغيّر اليوم فقط؛ الساعة وفرق التوقيت يبقيان كما كتبهما Blogger
      const time = /^\d{4}-\d{2}-\d{2}(T.+)$/.exec(String(post.date))?.[1] ?? 'T12:00:00+03:00';
      post.date = `${change.date}${time}`;
    }
    if (change.labels !== undefined) post.labels = change.labels;
    const nextRaw = serializePost(post, raw);
    if (nextRaw !== raw) additions.push({ path, contents: nextRaw });

    if (change.classification !== undefined) {
      const taxonomy = parseTaxonomy(snapshot.taxonomyRaw);
      const problem = classificationProblem(taxonomy, change.classification);
      if (problem) return { kind: 'invalid', errors: { classification: problem } };
      if (applyClassification(taxonomy, slug, change.classification)) {
        additions.push({ path: PATHS.taxonomy, contents: serializeTaxonomy(taxonomy, snapshot.taxonomyRaw) });
      }
    }

    if (additions.length === 0) return { kind: 'unchanged' };

    const commit = await createCommit(repo, {
      expectedHead: snapshot.head,
      headline: `لوحة التحرير: تعديل بيانات «${inHeadline(String(post.title))}»`,
      body: `${path}\nالحقول: ${Object.keys(change).join('، ')}`,
      additions,
    });
    return { kind: 'saved', commit };
  });
}

/**
 * حذف كامل في commit واحد: ملف التدوينة + مفتاحها في التصنيف + سطر في قائمة المحذوفات.
 * القائمة تمنع المزامنة من إعادة استيرادها من Blogger، وهي مصدر الاسترجاع لاحقاً.
 */
export async function deletePost(repo: RepoConfig, slug: string, nowMs: number = Date.now()): Promise<DeleteResult> {
  return retryOnMove<DeleteResult>(async () => {
    const snapshot = await readSnapshot(repo, PATHS);

    const removed = parseRemoved(snapshot.removedRaw);
    const recent = removed.posts.map((entry) => Date.parse(entry.removed_at)).filter((time) => nowMs - time < HOUR_MS);
    if (recent.length >= MAX_DELETES_PER_HOUR) {
      return { kind: 'brake', minutes: Math.ceil((Math.min(...recent) + HOUR_MS - nowMs) / 60_000) };
    }

    const summary = findBySlug(await summarize(repo, snapshot), slug);
    if (!summary) return { kind: 'missing' };

    removed.posts.push({
      slug,
      title: summary.title,
      date: summary.date,
      url: summary.url,
      file: summary.file,
      removed_at: new Date(nowMs).toISOString(),
      removed_from: snapshot.head,
    });
    const additions: FileAddition[] = [{ path: PATHS.removed, contents: `${JSON.stringify(removed, null, 2)}\n` }];

    const taxonomy = parseTaxonomy(snapshot.taxonomyRaw);
    if (applyClassification(taxonomy, slug, { type: 'none' })) {
      additions.push({ path: PATHS.taxonomy, contents: serializeTaxonomy(taxonomy, snapshot.taxonomyRaw) });
    }

    const path = `${PATHS.posts}/${summary.file}`;
    const commit = await createCommit(repo, {
      expectedHead: snapshot.head,
      headline: `لوحة التحرير: حذف «${inHeadline(summary.title)}»`,
      body: `${path}\nللاسترجاع: الملف كما كان عند ${snapshot.head}`,
      additions,
      deletions: [path],
    });
    return { kind: 'deleted', commit, title: summary.title };
  });
}
