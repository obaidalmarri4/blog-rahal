/**
 * GitHub وهمي في الذاكرة: القدر الذي تستعمله لوحة التحرير من الـAPI، لا أكثر.
 *
 *   POST /graphql                                  قراءة حالة الفرع · createCommitOnBranch
 *   GET  /repos/:owner/:name/contents/<path>?ref=  ملف خام عند commit بعينه
 *   GET  /repos/:owner/:name/commits/:sha/status   حالة النشر
 *
 * يستعمله scripts/studio-write-check.mjs ليختبر الكتابة بلا مساس بالمستودع الحقيقي، وليصنع
 * ما لا يُصنع على GitHub عند الطلب: دفعة من البوت بين القراءة والكتابة، عطل، توكن مرفوض.
 *
 * أشكال الردود (ومنها خطأ STALE_DATA) منقولة عن ردود GitHub الحقيقية في 2026-11-20.
 * تغيير في src/lib/studio/github.ts يغيّر الاستعلام يحتاج تحديثاً هنا.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { gitBlobOid } from '../../src/lib/studio/summary.js';

const newOid = () => crypto.randomBytes(20).toString('hex');

/**
 * @param {object} options
 * @param {string} options.root جذر مشروع تُقرأ منه الملفات الأولى (التدوينات والتصنيف)
 * @param {string} options.token التوكن الوحيد المقبول
 * @param {string} options.repo ‎"owner/name"‎
 * @param {string} options.branch الفرع الوحيد الموجود
 * @param {string[]} options.seed مسارات (ملفات أو مجلدات) نسبةً إلى الجذر
 */
export async function createFakeGitHub({ root, token, repo, branch, seed }) {
  /** @type {Map<string, Buffer>} */
  let files = new Map();
  for (const entry of seed) {
    const absolute = path.join(root, entry);
    if (!fs.existsSync(absolute)) continue;
    if (fs.statSync(absolute).isDirectory()) {
      for (const name of fs.readdirSync(absolute)) files.set(`${entry}/${name}`, fs.readFileSync(path.join(absolute, name)));
    } else {
      files.set(entry, fs.readFileSync(absolute));
    }
  }

  let head = newOid();
  /** كل commit ومحتواه — للقراءة الخام عند ‎?ref=‎ */
  const commits = new Map([[head, files]]);
  const oids = new WeakMap();
  const oidOf = (buffer) => {
    if (!oids.has(buffer)) oids.set(buffer, gitBlobOid(buffer));
    return oids.get(buffer);
  };

  const fake = {
    url: '',
    /** سجل ما طُلب: ‎{ kind: 'snapshot' | 'commit' | 'stale' | 'raw' | 'status' | 'denied', … }‎ */
    log: [],
    /** يُقصّ نص الملف في GraphQL فوق هذا الحجم (كما يفعل GitHub مع الملفات الكبيرة) */
    truncateOver: Infinity,
    /** ‎sha → [{ context, state }]‎ */
    statuses: new Map(),

    get head() {
      return head;
    },
    paths: () => [...files.keys()],
    read: (file) => files.get(file)?.toString('utf-8'),
    count: (kind) => fake.log.filter((entry) => entry.kind === kind).length,

    /** دفعة من خارج اللوحة (بوت المزامنة مثلاً): تحرّك الفرع */
    push({ additions = {}, deletions = [], headline = 'external push' }) {
      const next = new Map(files);
      for (const [file, contents] of Object.entries(additions)) next.set(file, Buffer.from(contents, 'utf-8'));
      for (const file of deletions) next.delete(file);
      files = next;
      head = newOid();
      commits.set(head, files);
      fake.log.push({ kind: 'external', headline, oid: head });
      return head;
    },

    /** دوال تُنفَّذ — واحدة لكل طلب كتابة قادم — قبل أن يُفحص expectedHeadOid */
    beforeCommit: [],
    /** أعطال قادمة: كل عنصر رمز حالة HTTP يُردّ به على الطلب التالي */
    failures: [],

    close: () => new Promise((resolve) => server.close(resolve)),
  };

  const send = (res, status, body, type = 'application/json; charset=utf-8') => {
    res.writeHead(status, { 'content-type': type });
    res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
  };

  function snapshot(variables) {
    if (variables.ref !== `refs/heads/${branch}` || `${variables.owner}/${variables.name}` !== repo) {
      fake.log.push({ kind: 'snapshot', ref: variables.ref, found: false });
      return { data: { repository: { ref: null } } };
    }
    fake.log.push({ kind: 'snapshot', ref: variables.ref, found: true });

    const blob = (file) => {
      const buffer = files.get(file);
      if (!buffer) return null;
      const isTruncated = buffer.length > fake.truncateOver;
      return { object: { text: isTruncated ? buffer.toString('utf-8').slice(0, fake.truncateOver) : buffer.toString('utf-8'), isTruncated } };
    };
    const prefix = `${variables.posts}/`;
    const entries = [...files.keys()]
      .filter((file) => file.startsWith(prefix))
      .sort()
      .map((file) => ({ name: file.slice(prefix.length), oid: oidOf(files.get(file)) }));

    return {
      data: {
        repository: {
          ref: { target: { oid: head, taxonomy: blob(variables.taxonomy), removed: blob(variables.removed), posts: { object: { entries } } } },
        },
      },
    };
  }

  function commit({ input }) {
    fake.beforeCommit.shift()?.();

    if (input.branch.branchName !== branch || input.branch.repositoryNameWithOwner !== repo) {
      return { data: { createCommitOnBranch: null }, errors: [{ type: 'NOT_FOUND', message: 'No such branch' }] };
    }
    if (input.expectedHeadOid !== head) {
      fake.log.push({ kind: 'stale', expected: input.expectedHeadOid, head });
      return {
        data: { createCommitOnBranch: null },
        errors: [
          {
            type: 'STALE_DATA',
            path: ['createCommitOnBranch'],
            message: `Expected branch to point to "${input.expectedHeadOid}" but it did not.  Pull and try again.`,
          },
        ],
      };
    }

    const additions = input.fileChanges?.additions ?? [];
    const deletions = input.fileChanges?.deletions ?? [];
    const missing = deletions.find((file) => !files.has(file.path));
    if (missing) {
      return { data: { createCommitOnBranch: null }, errors: [{ type: 'UNPROCESSABLE', message: `A path was requested for deletion which does not exist as of commit oid ${head}: ${missing.path}` }] };
    }

    const next = new Map(files);
    for (const file of additions) next.set(file.path, Buffer.from(file.contents, 'base64'));
    for (const file of deletions) next.delete(file.path);
    files = next;
    const parent = head;
    head = newOid();
    commits.set(head, files);
    fake.log.push({
      kind: 'commit',
      oid: head,
      parent,
      headline: input.message.headline,
      body: input.message.body ?? '',
      added: additions.map((file) => file.path),
      deleted: deletions.map((file) => file.path),
    });
    return { data: { createCommitOnBranch: { commit: { oid: head } } } };
  }

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      if (req.headers.authorization !== `Bearer ${token}`) {
        fake.log.push({ kind: 'denied' });
        return send(res, 401, { message: 'Bad credentials' });
      }
      if (fake.failures.length > 0) return send(res, fake.failures.shift(), { message: 'Server Error' });

      const url = new URL(req.url, 'http://fake');
      if (req.method === 'POST' && url.pathname === '/graphql') {
        const { query, variables } = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
        return send(res, 200, query.includes('createCommitOnBranch') ? commit(variables) : snapshot(variables));
      }

      const contents = new RegExp(`^/repos/${repo}/contents/(.+)$`).exec(url.pathname);
      if (req.method === 'GET' && contents) {
        const file = decodeURIComponent(contents[1]);
        const buffer = commits.get(url.searchParams.get('ref'))?.get(file);
        fake.log.push({ kind: 'raw', file, found: Boolean(buffer) });
        return buffer ? send(res, 200, buffer, 'application/vnd.github.raw+json; charset=utf-8') : send(res, 404, { message: 'Not Found' });
      }

      const status = new RegExp(`^/repos/${repo}/commits/([0-9a-f]{40})/status$`).exec(url.pathname);
      if (req.method === 'GET' && status) {
        fake.log.push({ kind: 'status', sha: status[1] });
        return send(res, 200, { state: 'pending', statuses: fake.statuses.get(status[1]) ?? [] });
      }

      return send(res, 404, { message: 'Not Found' });
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  fake.url = `http://127.0.0.1:${server.address().port}`;
  return fake;
}
