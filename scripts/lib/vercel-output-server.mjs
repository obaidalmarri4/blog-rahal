#!/usr/bin/env node
/**
 * خادم محلي صغير يشغّل ناتج البناء ‎.vercel/output‎ بالترتيب الذي يوجّه به Vercel الطلبات:
 * الملف الساكن إن وُجد، ثم قواعد config.json — دالة الخادم أو ‎/404.html‎.
 *
 * لماذا يوجد: `astro preview` لا يعمل مع محوّل Vercel، و`astro dev` لا يشغّل الحزمة التي
 * تُنشر فعلاً. هذا يشغّلها هي نفسها، فما يُختبر هنا هو ما سيعمل على الموقع.
 * يستعمله scripts/studio-access-check.mjs، ويصلح لتجربة اللوحة يدوياً:
 *
 *   npm run build
 *   STUDIO_KEY=<مفتاح تجريبي من 32 حرفاً فأكثر> node scripts/lib/vercel-output-server.mjs
 *   ثم افتح: http://localhost:4322/studio/enter/<المفتاح>
 *
 * محاكاة لتوجيه Vercel بالقدر الذي يحتاجه هذا الموقع، لا أكثر: لا ضغط، لا تخزين مؤقت،
 * ولا ترويسات ‎continue‎.
 */

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.otf': 'font/otf',
  '.woff2': 'font/woff2',
};

/**
 * @param {string} outputDir مسار ‎.vercel/output‎
 * @param {{ forceFunctionHeader?: string }} [options] ترويسة اختبار: الطلب الذي يحملها يذهب
 *   إلى دالة الخادم مباشرة مهما كان مساره — لاختبار «ماذا لو وصل هذا العنوان إلى الدالة؟»
 */
export async function createOutputServer(outputDir, { forceFunctionHeader } = {}) {
  const staticDir = path.join(outputDir, 'static');
  const config = JSON.parse(fs.readFileSync(path.join(outputDir, 'config.json'), 'utf-8'));
  const filesystemAt = config.routes.findIndex((route) => route.handle === 'filesystem');
  const routes = config.routes
    .slice(filesystemAt + 1)
    .filter((route) => route.src && route.dest)
    .map((route) => ({ ...route, pattern: new RegExp(route.src) }));

  const stats = { static: 0, function: 0, fallback: 0 };
  const handlers = new Map();

  async function functionHandler(name) {
    if (!handlers.has(name)) {
      const dir = path.join(outputDir, 'functions', `${name}.func`);
      const { handler } = JSON.parse(fs.readFileSync(path.join(dir, '.vc-config.json'), 'utf-8'));
      const mod = await import(pathToFileURL(path.join(dir, handler)).href);
      handlers.set(name, mod.default);
    }
    return handlers.get(name);
  }

  function staticFile(pathname) {
    let decoded;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      return null;
    }
    const file = path.join(staticDir, decoded);
    if (file !== staticDir && !file.startsWith(staticDir + path.sep)) return null;
    for (const candidate of [file, path.join(file, 'index.html')]) {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    }
    return null;
  }

  function sendFile(res, status, file) {
    res.writeHead(status, {
      'content-type': CONTENT_TYPES[path.extname(file)] || 'application/octet-stream',
      'cache-control': 'public, max-age=0, must-revalidate',
    });
    fs.createReadStream(file).pipe(res);
  }

  const server = http.createServer(async (req, res) => {
    try {
      const pathname = req.url.split('?')[0];

      if (forceFunctionHeader && req.headers[forceFunctionHeader]) {
        stats.function++;
        return await (await functionHandler('_render'))(req, res);
      }

      const file = staticFile(pathname);
      if (file) {
        stats.static++;
        return sendFile(res, 200, file);
      }

      for (const route of routes) {
        if (!route.pattern.test(pathname)) continue;
        if (route.dest.startsWith('/')) {
          stats.fallback++;
          return sendFile(res, route.status ?? 200, path.join(staticDir, route.dest));
        }
        stats.function++;
        return await (await functionHandler(route.dest))(req, res);
      }

      res.writeHead(404, { 'content-type': 'text/plain' }).end('NOT_FOUND');
    } catch (err) {
      // دالة رمت خطأ: Vercel يردّ 500 ولا يعرض شيئاً من الصفحة
      if (process.env.DEBUG) console.error(err);
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain' });
      res.end('FUNCTION_INVOCATION_FAILED');
    }
  });

  return {
    stats,
    routes,
    staticDir,
    listen: (port = 0, host = '127.0.0.1') =>
      new Promise((resolve) => server.listen(port, host, () => resolve(server.address().port))),
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

// تشغيل مباشر: node scripts/lib/vercel-output-server.mjs [مسار الناتج] [المنفذ]
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const outputDir = path.resolve(process.argv[2] || path.join(root, '.vercel/output'));
  if (!fs.existsSync(path.join(outputDir, 'config.json'))) {
    console.error(`لا يوجد ناتج بناء في ${outputDir} — شغّل npm run build أولاً.`);
    process.exit(1);
  }
  const output = await createOutputServer(outputDir);
  const port = await output.listen(Number(process.argv[3] || process.env.PORT || 4322), 'localhost');
  console.log(`ناتج البناء يعمل على http://localhost:${port}`);
  if (!process.env.STUDIO_KEY) console.log('STUDIO_KEY غير مضبوط: اللوحة مغلقة (404).');
}
