/**
 * إعداد اتصال اللوحة بالمستودع: أين تقرأ وتكتب، وبأي توكن.
 */

import { getSecret } from 'astro:env/server';
import type { RepoConfig } from './github.ts';

/** مسارات المستودع التي تتعامل معها اللوحة */
export const PATHS = {
  posts: 'src/content/posts',
  taxonomy: 'src/data/taxonomy.json',
  removed: 'src/data/removed-posts.json',
};

const DEFAULT_REPO = 'obaidalmarri4/blog-rahal';
/** الفرع الذي يبنيه Vercel للموقع الحيّ */
const PRODUCTION_BRANCH = 'main';
const SANDBOX_BRANCH = 'studio-sandbox';

/**
 * null إن لم يُضبط `STUDIO_GITHUB_TOKEN` — اللوحة تفتح وتقول ذلك، ولا تقرأ ولا تكتب.
 *
 * الفرع: ‎`main`‎ في إنتاج Vercel فقط. في أي مكان آخر (جهاز المطوّر) الافتراضي فرع التجربة
 * ‎`studio-sandbox`‎، فلا تصل تجربة محلية إلى الموقع الحيّ إلا بضبط `STUDIO_BRANCH=main` عمداً.
 */
export function studioRepo(): RepoConfig | null {
  const token = getSecret('STUDIO_GITHUB_TOKEN');
  if (!token) return null;

  const [owner, name, ...extra] = (getSecret('STUDIO_REPO') || DEFAULT_REPO).split('/');
  if (!owner || !name || extra.length > 0) return null;

  const onProduction = getSecret('VERCEL_ENV') === 'production';
  return {
    // يُغيَّر في الاختبار فقط (scripts/studio-write-check.mjs يوجّهه إلى GitHub وهمي)
    api: (getSecret('STUDIO_GITHUB_API') || 'https://api.github.com').replace(/\/+$/, ''),
    token,
    owner,
    name,
    branch: getSecret('STUDIO_BRANCH') || (onProduction ? PRODUCTION_BRANCH : SANDBOX_BRANCH),
    deployContext: getSecret('STUDIO_DEPLOY_CONTEXT') || 'Vercel – blog-rahal',
  };
}

/** هل ما يُحفظ على هذا الفرع يُنشر على الموقع الحيّ؟ */
export function publishesToSite(repo: RepoConfig): boolean {
  return repo.branch === PRODUCTION_BRANCH;
}
