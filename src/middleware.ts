/**
 * حارس لوحة التحرير. يعمل على ‎/studio/**‎ و ‎/api/studio/**‎ فقط ويترك كل ما عداهما كما هو.
 *
 * القاعدة: من لا يحمل اقتراناً صالحاً يرى صفحة «غير موجودة» نفسها التي يراها زائر أي عنوان
 * خاطئ — لا شاشة دخول، ولا ردّ يختلف بين «مفتاح خاطئ» و«لا توجد لوحة».
 *
 * الحارس هو مَن يضع `locals.studio`، وكل صفحة ونقطة في اللوحة تتحقق منها هي أيضاً
 * (انظر src/lib/studio/guard.ts): لو أخطأ هذا الملف في مطابقة مسار، يبقى الباب مغلقاً.
 */

import { defineMiddleware } from 'astro:middleware';
import { pairDevice, studioKey } from './lib/studio/access.ts';
import { COOKIE_NAME, keysMatch, readSession } from './lib/studio/session.ts';

const STUDIO_ROOTS = ['/studio', '/api/studio'];
const ENTER_ROUTE = '/studio/enter/[key]';
/** توأم صفحة 404 العامة، يُعرض من الخادم (src/pages/studio/not-found.astro) */
const NOT_FOUND_ROUTE = '/studio/not-found';
const SAFE_METHODS = ['GET', 'HEAD'];

function isStudioPath(url: URL): boolean {
  let path = url.pathname;
  try {
    path = decodeURIComponent(path);
  } catch {
    // ترميز معطوب: يُطابَق كما هو
  }
  path = path.replace(/\/{2,}/g, '/');
  return STUDIO_ROOTS.some((root) => path === root || path.startsWith(`${root}/`));
}

/** النطاق كما طلبه العميل، بترتيب Astro نفسه: X-Forwarded-Host (يضعها Vercel) ثم Host */
function requestedHost(request: Request): string | null {
  const forwarded = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  return forwarded || request.headers.get('host');
}

/** طلب كتابة من صفحات الموقع نفسه؟ (حماية CSRF فوق SameSite=Lax) */
function isSameOrigin(request: Request, url: URL): boolean {
  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite !== null && fetchSite !== 'same-origin') return false;
  return request.headers.get('origin') === url.origin;
}

/**
 * ترويسات كل ردّ من اللوحة: لا فهرسة، لا تخزين، ولا يتسرّب عنوانها لمواقع الصور الخارجية.
 *
 * Referrer-Policy هي `same-origin` لا `no-referrer` عمداً: مع `no-referrer` يرسل المتصفح
 * ‎`Origin: null`‎ في طلبات POST حتى من الموقع نفسه، فيرفضها فحص Origin (هنا وفي Astro) —
 * أي أن كل زر في اللوحة يتعطّل. `same-origin` تحجب العنوان عن المواقع الأخرى وتُبقي Origin.
 */
function sealed(response: Response): Response {
  response.headers.set('X-Robots-Tag', 'noindex, nofollow');
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('Referrer-Policy', 'same-origin');
  return response;
}

export const onRequest = defineMiddleware(async (context, next) => {
  if (!isStudioPath(context.url)) {
    // الصفحات العامة — وكلها تُبنى ساكنة — تمرّ بلا أي لمس. يجب أن يبقى هذا أول فحص:
    // قراءة الترويسات أو الكوكي وقت البناء تُسقط البناء الساكن.
    if (context.isPrerendered) return next();
    // ما بقي هو نقاط Astro الداخلية التي يضيفها مع أي محوّل (‎/_image‎ و ‎/_server-islands‎).
    // الموقع لا يستعملها، فتُغلق: اللوحة هي الشيء الوحيد الذي يعمل على الخادم.
    return new Response('Not found', { status: 404 });
  }

  const notFound = async () => {
    const response = await next(NOT_FOUND_ROUTE);
    // نفس ما يرسله Vercel مع الملفات الساكنة — ويمنع المتصفح من الاحتفاظ بالـ404 بعد الاقتران
    response.headers.set('Cache-Control', 'public, max-age=0, must-revalidate');
    return response;
  };

  const key = studioKey();
  if (!key) return notFound();

  // اللوحة تعمل على النطاقات الموثوقة فقط (security.allowedDomains في astro.config.mjs).
  // على غيرها يضع Astro «localhost» مكان النطاق، ومحوّل Vercel يقبل مساراً بديلاً
  // (‎?x_astro_path=‎) يُلصَق بعد اسم النطاق فيغيّره — وفي الحالتين يفقد فحص Origin أدناه
  // معناه. لذلك: النطاق الذي يراه Astro يجب أن يكون هو النطاق الذي طُلب فعلاً.
  if (requestedHost(context.request) !== context.url.host) return notFound();

  if (context.routePattern === ENTER_ROUTE) {
    if (!keysMatch(context.params.key ?? '', key)) return notFound();
    context.locals.studio = 'entering';
    return sealed(await next());
  }

  const session = readSession(context.cookies.get(COOKIE_NAME)?.value, key);
  if (!session) return notFound();

  if (!SAFE_METHODS.includes(context.request.method) && !isSameOrigin(context.request, context.url)) {
    return sealed(new Response('Forbidden', { status: 403 }));
  }

  context.locals.studio = 'paired';
  if (session.renew) pairDevice(context.cookies, key);
  return sealed(await next());
});
