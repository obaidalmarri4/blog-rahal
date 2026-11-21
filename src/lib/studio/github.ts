/**
 * عميل GitHub للوحة التحرير: قراءة حالة الفرع، قراءة ملف، وكتابة commit ذرّي.
 *
 * اللوحة بلا قاعدة بيانات — المستودع هو المخزن. كل كتابة تمرّ من createCommitOnBranch مع
 * `expectedHeadOid`: إن تحرّك الفرع بين القراءة والكتابة (بوت المزامنة، أو تعديل من جهاز آخر)
 * يرفض GitHub الكتابة بـSTALE_DATA، فيعيد المستدعي القراءة ويطبّق تغييره من جديد. لا شيء
 * يُكتب فوق شيء لم يُقرأ.
 *
 * دوال خالصة (الإعداد يُمرَّر لها): لا تلمس `astro:*`.
 * أشكال الردود هنا تحقّقتُ منها على GitHub الحقيقي في 2026-11-20 — انظر plans/011.
 */

export interface RepoConfig {
  /** أصل الـAPI؛ ‎https://api.github.com‎ إلا في الاختبار */
  api: string;
  token: string;
  owner: string;
  name: string;
  branch: string;
  /** اسم فحص النشر على الـcommit، مثل «Vercel – blog-rahal» */
  deployContext: string;
}

export type GitHubErrorCode = 'network' | 'http' | 'graphql' | 'no_branch' | 'busy';

export class GitHubError extends Error {
  code: GitHubErrorCode;
  status?: number;

  constructor(code: GitHubErrorCode, message: string, status?: number) {
    super(message);
    this.name = 'GitHubError';
    this.code = code;
    this.status = status;
  }
}

/** الفرع تحرّك منذ القراءة — أعد القراءة وحاول من جديد */
export class StaleHeadError extends Error {
  constructor() {
    super('branch moved since it was read');
    this.name = 'StaleHeadError';
  }
}

export interface TreeEntry {
  name: string;
  /** معرّف محتوى الملف في Git (blob sha1) — يتغيّر إن تغيّر حرف في الملف */
  oid: string;
}

/** حالة الفرع عند commit واحد بعينه: كل ما فيها متّسق مع `head` */
export interface Snapshot {
  head: string;
  taxonomyRaw: string;
  /** null إن لم يُنشأ ملف المحذوفات بعد */
  removedRaw: string | null;
  posts: TreeEntry[];
}

export interface FileAddition {
  path: string;
  contents: string;
}

export interface CommitRequest {
  expectedHead: string;
  headline: string;
  body?: string;
  additions?: FileAddition[];
  deletions?: string[];
}

export type DeployState = 'pending' | 'success' | 'failure' | 'unknown';

const TIMEOUT_MS = 20_000;
/** أعطال عابرة من GitHub نفسه — ظهر 503 على قراءة أثناء تجربة فرع studio-sandbox (2026-11-21) */
const TRANSIENT = new Set([502, 503, 504]);
const RETRY_PAUSE_MS = 400;

async function send(repo: RepoConfig, path: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(`${repo.api}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${repo.token}`,
        'User-Agent': 'rahal-studio',
        'X-GitHub-Api-Version': '2022-11-28',
        ...init.headers,
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new GitHubError('network', err instanceof Error ? err.message : String(err));
  }
}

/**
 * طلب إلى GitHub. `repeatable` = قراءة لا تغيّر شيئاً: تُعاد مرة واحدة إن ردّ GitHub بعطل عابر.
 * الكتابة لا تُعاد هكذا أبداً — ردّ 5xx لا يقول هل نُفّذ الـcommit أم لا.
 */
async function call(repo: RepoConfig, path: string, init: RequestInit = {}, repeatable = false): Promise<Response> {
  const res = await send(repo, path, init);
  if (!repeatable || !TRANSIENT.has(res.status)) return res;
  await res.body?.cancel();
  await new Promise((resolve) => setTimeout(resolve, RETRY_PAUSE_MS));
  return send(repo, path, init);
}

interface GraphQLError {
  type?: string;
  message?: string;
}

/**
 * «الفرع تحرّك منذ قُرئ» يقولها GitHub بشكلين (الثاني ثبت بالتجربة على المستودع الحقيقي 2026-11-21):
 *   - `STALE_DATA`: الفرع تحرّك قبل وصول طلب الكتابة.
 *   - `FORBIDDEN` برسالة ‎"is at <oid> but expected <oid>"‎: كتابتان وصلتا في اللحظة نفسها؛ فحص الرأس
 *     مرّ للاثنتين، ثم خسرت هذه تحديث الفرع.
 * النوع `FORBIDDEN` يحمله أيضاً رفض الصلاحيات الحقيقي (توكن للقراءة فقط)، وذاك لا يُعاد؛ فلا يميّز
 * الحالة الثانية إلا نص رسالتها كاملاً.
 */
const HEAD_MOVED_MESSAGE = /^is at [0-9a-f]{40} but expected [0-9a-f]{40}$/;
const headMoved = (error: GraphQLError): boolean => error.type === 'STALE_DATA' || HEAD_MOVED_MESSAGE.test(error.message ?? '');

async function graphql<T>(repo: RepoConfig, query: string, variables: Record<string, unknown>, repeatable = false): Promise<T> {
  const res = await call(
    repo,
    '/graphql',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    },
    repeatable
  );
  if (!res.ok) throw new GitHubError('http', `GitHub GraphQL ${res.status}`, res.status);

  const payload = (await res.json()) as { data?: T; errors?: GraphQLError[] };
  if (payload.errors?.length) {
    if (payload.errors.some(headMoved)) throw new StaleHeadError();
    throw new GitHubError('graphql', payload.errors.map((error) => error.message).join(' | '));
  }
  if (!payload.data) throw new GitHubError('graphql', 'empty GraphQL response');
  return payload.data;
}

const SNAPSHOT_QUERY = `
query ($owner: String!, $name: String!, $ref: String!, $taxonomy: String!, $removed: String!, $posts: String!) {
  repository(owner: $owner, name: $name) {
    ref(qualifiedName: $ref) {
      target {
        ... on Commit {
          oid
          taxonomy: file(path: $taxonomy) { object { ... on Blob { text isTruncated } } }
          removed: file(path: $removed) { object { ... on Blob { text isTruncated } } }
          posts: file(path: $posts) { object { ... on Tree { entries { name oid } } } }
        }
      }
    }
  }
}`;

interface BlobField {
  object: { text: string | null; isTruncated: boolean } | null;
}

interface SnapshotData {
  repository: {
    ref: {
      target: {
        oid: string;
        taxonomy: BlobField | null;
        removed: BlobField | null;
        posts: { object: { entries: TreeEntry[] } | null } | null;
      };
    } | null;
  } | null;
}

export interface SnapshotPaths {
  taxonomy: string;
  removed: string;
  posts: string;
}

/** رأس الفرع + ملفّا التصنيف والمحذوفات + أسماء ملفات التدوينات ومعرّفاتها — في طلب واحد */
export async function readSnapshot(repo: RepoConfig, paths: SnapshotPaths): Promise<Snapshot> {
  const data = await graphql<SnapshotData>(
    repo,
    SNAPSHOT_QUERY,
    {
      owner: repo.owner,
      name: repo.name,
      ref: `refs/heads/${repo.branch}`,
      ...paths,
    },
    true
  );

  const target = data.repository?.ref?.target;
  if (!target) throw new GitHubError('no_branch', `branch "${repo.branch}" not found`);
  const head = target.oid;

  // GraphQL يقصّ الملفات الكبيرة (تحقّقت: 980KB يُقصّ) — عندها يُقرأ الملف خاماً
  const blob = async (field: BlobField | null, path: string): Promise<string | null> => {
    if (!field?.object) return null;
    if (field.object.isTruncated || field.object.text === null) return readFile(repo, path, head);
    return field.object.text;
  };

  const taxonomyRaw = await blob(target.taxonomy, paths.taxonomy);
  if (taxonomyRaw === null) throw new GitHubError('graphql', `${paths.taxonomy} is missing on ${repo.branch}`);

  return {
    head,
    taxonomyRaw,
    removedRaw: await blob(target.removed, paths.removed),
    posts: target.posts?.object?.entries ?? [],
  };
}

/** محتوى ملف كما هو عند commit بعينه (حتى 100MB) */
export async function readFile(repo: RepoConfig, path: string, ref: string): Promise<string> {
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  const res = await call(
    repo,
    `/repos/${repo.owner}/${repo.name}/contents/${encoded}?ref=${encodeURIComponent(ref)}`,
    { headers: { Accept: 'application/vnd.github.raw+json' } },
    true
  );
  if (!res.ok) throw new GitHubError('http', `GitHub contents ${res.status} for ${path}`, res.status);
  return res.text();
}

const COMMIT_MUTATION = `
mutation ($input: CreateCommitOnBranchInput!) {
  createCommitOnBranch(input: $input) { commit { oid } }
}`;

/** commit واحد لكل الملفات معاً. يرمي StaleHeadError إن لم يعد الفرع عند `expectedHead` */
export async function createCommit(repo: RepoConfig, request: CommitRequest): Promise<string> {
  const data = await graphql<{ createCommitOnBranch: { commit: { oid: string } } | null }>(repo, COMMIT_MUTATION, {
    input: {
      branch: { repositoryNameWithOwner: `${repo.owner}/${repo.name}`, branchName: repo.branch },
      expectedHeadOid: request.expectedHead,
      message: { headline: request.headline, ...(request.body ? { body: request.body } : {}) },
      fileChanges: {
        additions: (request.additions ?? []).map((file) => ({
          path: file.path,
          contents: Buffer.from(file.contents, 'utf-8').toString('base64'),
        })),
        deletions: (request.deletions ?? []).map((path) => ({ path })),
      },
    },
  });
  const oid = data.createCommitOnBranch?.commit.oid;
  if (!oid) throw new GitHubError('graphql', 'createCommitOnBranch returned no commit');
  return oid;
}

/** حالة نشر commit كما يكتبها Vercel على GitHub — فلا تحتاج اللوحة توكن Vercel */
export async function deployState(repo: RepoConfig, sha: string): Promise<{ state: DeployState; url: string | null }> {
  const res = await call(repo, `/repos/${repo.owner}/${repo.name}/commits/${sha}/status`, { headers: { Accept: 'application/vnd.github+json' } }, true);
  if (!res.ok) throw new GitHubError('http', `GitHub status ${res.status}`, res.status);

  const payload = (await res.json()) as { statuses?: { context: string; state: string; target_url: string | null }[] };
  const status = payload.statuses?.find((entry) => entry.context === repo.deployContext);
  // Vercel يكتب الحالة بعد ثوانٍ من الـcommit؛ قبلها لا يوجد شيء بعد
  if (!status) return { state: 'pending', url: null };

  const state: DeployState =
    status.state === 'success' ? 'success' : status.state === 'pending' ? 'pending' : status.state === 'failure' || status.state === 'error' ? 'failure' : 'unknown';
  return { state, url: status.target_url };
}
