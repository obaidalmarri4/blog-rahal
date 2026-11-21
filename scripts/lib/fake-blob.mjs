/**
 * Vercel Blob وهمي في الذاكرة: طلب الرفع الوحيد الذي تستعمله اللوحة (put عبر @vercel/blob).
 *
 *   PUT /?pathname=<المسار>   ← جسم الملف، وترويسات x-vercel-blob-access و x-content-type …
 *                             → { url, downloadUrl, pathname, contentType, contentDisposition, etag }
 *
 * يشغَّل بضبط VERCEL_BLOB_API_URL على عنوانه (تقرؤه @vercel/blob) و BLOB_READ_WRITE_TOKEN على
 * `token`. العناوين التي يعيدها بشكل عناوين المتجر العام الحقيقية (‎https://<store>.public.blob.vercel-storage.com/…‎)
 * ليعاملها extractImages معاملة صور الموقع — ولا تُفتح فعلاً.
 */

import crypto from 'node:crypto';
import http from 'node:http';

/**
 * @param {{ store?: string, serve?: boolean }} [options] `serve`: العناوين تشير إلى الخادم الوهمي نفسه ويقدّم
 *   الملفات المرفوعة — لتجربة المحرّر في متصفح حقيقي (وعندها لا يعدّها extractImages صور الموقع).
 */
export async function createFakeBlob({ store = 'fakestore', serve = false } = {}) {
  const fake = {
    url: '',
    token: `vercel_blob_rw_${store}_${crypto.randomBytes(12).toString('hex')}`,
    /** pathname → { bytes, headers } */
    uploads: new Map(),
    /** رموز حالة يُردّ بها على طلبات الرفع القادمة بلا كتابة */
    failures: [],
    log: [],
    close: () => new Promise((resolve) => server.close(resolve)),
  };

  const send = (res, status, body) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const url = new URL(req.url, 'http://fake');
      if (serve && req.method === 'GET') {
        const file = fake.uploads.get(decodeURIComponent(url.pathname.slice(1)));
        if (!file) return send(res, 404, { error: 'not found' });
        res.writeHead(200, { 'content-type': file.headers['x-content-type'] ?? 'application/octet-stream' });
        return res.end(file.bytes);
      }
      if (req.headers.authorization !== `Bearer ${fake.token}`) {
        fake.log.push({ kind: 'denied' });
        return send(res, 403, { error: { code: 'forbidden', message: 'Access denied' } });
      }
      if (req.method !== 'PUT' || url.pathname !== '/' || !url.searchParams.get('pathname')) {
        fake.log.push({ kind: 'unexpected', method: req.method, path: req.url });
        return send(res, 400, { error: { code: 'bad_request', message: 'unexpected request' } });
      }
      const failure = fake.failures.shift();
      if (failure) {
        fake.log.push({ kind: 'failed', status: failure });
        return send(res, failure, { error: { code: 'forbidden', message: 'Access denied' } });
      }
      const pathname = url.searchParams.get('pathname');
      const bytes = Buffer.concat(chunks);
      fake.uploads.set(pathname, { bytes, headers: req.headers });
      fake.log.push({ kind: 'put', pathname, size: bytes.length });
      const publicUrl = serve ? `${fake.url}/${pathname}` : `https://${store}.public.blob.vercel-storage.com/${pathname}`;
      send(res, 200, {
        url: publicUrl,
        downloadUrl: `${publicUrl}?download=1`,
        pathname,
        contentType: req.headers['x-content-type'] ?? 'application/octet-stream',
        contentDisposition: `inline; filename="${pathname.split('/').at(-1)}"`,
        etag: `"${crypto.createHash('md5').update(bytes).digest('hex')}"`,
      });
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  fake.url = `http://127.0.0.1:${server.address().port}`;
  return fake;
}

/**
 * ملف بترويسة JPEG صحيحة (APP0 ثم SOF0 بالأبعاد المطلوبة) وحشو حتى الحجم المطلوب. يكفي لفحص
 * الخادم، الذي يقرأ الترويسة ولا يفكّ الصورة.
 */
export function fakeJpeg(width, height, size = 2000) {
  const head = Buffer.from([
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03,
    0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
  ]);
  return Buffer.concat([head, Buffer.alloc(Math.max(0, size - head.length - 2)), Buffer.from([0xff, 0xd9])]);
}
