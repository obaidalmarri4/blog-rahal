/**
 * محرّر نص التدوينة، بوضعين:
 *   - ‎edit‎ (‎/studio/edit/<slug>‎): يحمّل النص طازجاً من ‎/api/studio/posts/<slug>‎ ويحفظه بطلب PUT.
 *   - ‎new‎ (‎/studio/new‎): محرّر فارغ مع نموذج الحقول، وينشر بطلب ‎POST /api/studio/posts‎.
 *
 * التحميل والتسلسل بدوال src/lib/studio/document.js نفسها التي تختبرها البوابات — لا بدوال
 * TipTap النصّية. الصور تُصغَّر في المتصفح (images.ts) وتُرفع إلى ‎/api/studio/media‎.
 */

import { Editor } from '@tiptap/core';
import { bodyForSave, loadBody, parseBody } from '../../lib/studio/document.js';
import { cleanPastedHTML } from '../../lib/studio/paste.js';
import { expandRawBlocks, splitRawBlocks } from '../../lib/studio/raw-blocks.js';
import { RawBlock, studioExtensions } from '../../lib/studio/schema.js';
import { watchDeploy } from './deploy-status.ts';
import { clearDraft, readDraft, writeDraft } from './drafts.ts';
import type { Draft } from './drafts.ts';
import { prepareImage } from './images.ts';

const SETTLE_MS = 1500;
/** مفتاح مسودة «تدوينة جديدة» على هذا الجهاز (التدوينات القائمة مفتاحها الـslug) */
const NEW_DRAFT = 'new';

/** وصف مختصر لكتلة محفوظة: يظهر مكانها في المحرّر (محتواها لا يُعرض ولا يُنفَّذ هنا) */
function describeRaw(html: string): { label: string; detail: string; thumb: string | null } {
  const tag = /^<([a-z0-9]+)/i.exec(html)?.[1].toLowerCase() ?? '';
  const keep = 'يبقى كما هو — يمكن حذفه أو نقله.';
  if (tag === 'iframe') {
    const id = /youtube(?:-nocookie)?\.com\/embed\/([\w-]{6,})/.exec(html)?.[1];
    return id
      ? { label: 'مقطع يوتيوب', detail: keep, thumb: `https://i.ytimg.com/vi/${id}/mqdefault.jpg` }
      : { label: 'مقطع مضمَّن', detail: keep, thumb: null };
  }
  if (tag === 'video' || tag === 'audio') return { label: tag === 'video' ? 'مقطع فيديو' : 'مقطع صوتي', detail: keep, thumb: null };
  if (tag === 'table') {
    // مستند خامل: لا سكربتات تُنفَّذ ولا صور تُحمَّل
    const text = new DOMParser().parseFromString(html, 'text/html').body.textContent ?? '';
    const excerpt = text.replace(/\s+/g, ' ').trim().slice(0, 110);
    return { label: 'جدول', detail: excerpt ? `${excerpt}…` : keep, thumb: null };
  }
  return { label: 'محتوى قديم محفوظ كما هو', detail: keep, thumb: null };
}

/** الكتلة المحفوظة في المحرّر: صندوق يُحدَّد ويُحذف ويُنقل، ولا يُكتب داخله */
const RawBlockView = RawBlock.extend({
  addNodeView() {
    return ({ node }) => {
      const info = describeRaw(node.attrs.html);
      const dom = document.createElement('div');
      dom.className = 'studio-raw';
      dom.contentEditable = 'false';
      if (info.thumb) {
        const image = document.createElement('img');
        image.src = info.thumb;
        image.alt = '';
        dom.append(image);
      }
      const text = document.createElement('span');
      const label = document.createElement('strong');
      label.textContent = info.label;
      const detail = document.createElement('small');
      detail.textContent = info.detail;
      text.append(label, detail);
      dom.append(text);
      return { dom };
    };
  },
});

const clock = (time: number) => new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', { hour: 'numeric', minute: '2-digit' }).format(time);

/** معرّف «تدوينة جديدة»: ستّة أحرف، يدخل في الـslug ويمنع نشرها مرتين */
function newPostId(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return [...crypto.getRandomValues(new Uint8Array(6))].map((byte) => alphabet[byte % alphabet.length]).join('');
}

type MetaSnapshot = Record<string, string | string[]>;

async function start(root: HTMLElement) {
  const mode = root.dataset.mode === 'new' ? 'new' : 'edit';
  const slug = root.dataset.slug ?? '';
  const draftKey = mode === 'new' ? NEW_DRAFT : slug;
  const query = <T extends HTMLElement>(selector: string) => root.querySelector<T>(selector)!;

  const mount = query('[data-editor-mount]');
  const notice = query('[data-editor-notice]');
  const stateLabel = query('[data-editor-state]');
  const saveButton = query<HTMLButtonElement>('[data-cmd="save"]');
  const toolbar = query('[data-editor-toolbar]');
  const linkBar = query('[data-editor-linkbar]');
  const linkInput = query<HTMLInputElement>('[data-editor-linkbar] input');
  const selectedBar = query('[data-editor-selected]');
  const altButton = query<HTMLButtonElement>('[data-cmd="alt"]');
  const altBar = query('[data-editor-altbar]');
  const altInput = query<HTMLInputElement>('[data-editor-altbar] input');
  const fileInput = query<HTMLInputElement>('[data-editor-file]');
  const sizeSelect = query<HTMLSelectElement>('[data-select="size"]');
  const blockSelect = query<HTMLSelectElement>('[data-select="block"]');
  const preview = document.querySelector<HTMLDialogElement>('[data-editor-preview]')!;
  const metaForm = root.querySelector<HTMLFormElement>('[data-new-meta]');

  /** رسالة فوق المحرّر، مع أزرار اختيارية */
  function announce(text: string, kind: 'info' | 'error' | 'saved', actions: [string, () => void][] = []) {
    notice.replaceChildren();
    notice.hidden = false;
    notice.dataset.kind = kind;
    delete notice.dataset.deploySha;
    delete notice.dataset.deployState;
    const message = document.createElement('span');
    message.textContent = text;
    notice.append(message);
    for (const [label, action] of actions) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'studio-chip';
      button.textContent = label;
      button.addEventListener('click', action);
      notice.append(button);
    }
    if (kind === 'error') notice.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  // ── حقول «تدوينة جديدة» ────────────────────────────────────────────────────

  /** الحقول كما في النموذج الآن — للمسودة وللنشر */
  function readMetaForm(): MetaSnapshot {
    if (!metaForm) return {};
    const form = new FormData(metaForm);
    const value = (name: string) => String(form.get(name) ?? '');
    return {
      title: value('title'),
      date: value('date'),
      labels: value('labels'),
      type: value('type'),
      country: value('country'),
      countries: form.getAll('countries').map(String),
      category: value('category'),
    };
  }

  function fillMetaForm(meta: MetaSnapshot) {
    if (!metaForm) return;
    for (const element of metaForm.elements) {
      const field = element as HTMLInputElement;
      if (!field.name || !(field.name in meta)) continue;
      const value = meta[field.name];
      if (field.type === 'radio') field.checked = field.value === value;
      else if (field.type === 'checkbox') field.checked = Array.isArray(value) && value.includes(field.value);
      else field.value = Array.isArray(value) ? value.join('\n') : value;
    }
  }

  function clearFieldErrors() {
    for (const error of root.querySelectorAll('[data-js-error]')) error.remove();
  }

  function showFieldErrors(errors: Record<string, string>) {
    clearFieldErrors();
    let first: HTMLElement | null = null;
    for (const [field, message] of Object.entries(errors)) {
      const holder = root.querySelector<HTMLElement>(`[data-field="${field}"]`);
      if (!holder) continue;
      const error = document.createElement('span');
      error.className = 'studio-error';
      error.setAttribute('role', 'alert');
      error.dataset.jsError = '';
      error.textContent = message;
      holder.append(error);
      first ??= holder;
    }
    first?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  // ── التحميل ────────────────────────────────────────────────────────────────

  let initialHtml = '';
  let base = '';
  if (mode === 'edit') {
    let body: { title: string; html: string; base: string; locked: boolean; error?: string };
    try {
      const response = await fetch(`/api/studio/posts/${encodeURIComponent(slug)}`, { headers: { Accept: 'application/json' } });
      body = await response.json();
      if (!response.ok) throw new Error(body.error);
    } catch (err) {
      mount.replaceChildren();
      return announce(err instanceof Error && err.message ? err.message : 'تعذّر فتح التدوينة. حدّث الصفحة.', 'error');
    }
    if (body.locked) {
      mount.replaceChildren();
      return announce('هذه التدوينة أكبر من أن تُحرَّر من اللوحة. عدّل بياناتها من صفحتها، ولتعديل نصها أخبر عبيد.', 'error');
    }
    initialHtml = body.html;
    base = body.base;
  }

  mount.replaceChildren();

  const editor = new Editor({
    element: mount,
    extensions: studioExtensions.map((extension) => (extension.name === 'rawBlock' ? RawBlockView : extension)),
    content: loadBody(initialHtml, document).doc.toJSON(),
    editorProps: {
      attributes: { class: 'post-content studio-page', dir: 'rtl', 'aria-label': 'نص التدوينة' },
      transformPastedHTML: (html) => cleanPastedHTML(html, document),
    },
  });

  const current = () => bodyForSave(editor.state.doc, document);
  /** ما في المستودع الآن، بتسلسل هذا المحرّر — «تغيّر شيء؟» تُقاس عليه */
  let saved = current();
  let postId = newPostId();
  let savedMeta = JSON.stringify(readMetaForm());
  let dirty = false;
  let saving = false;
  let uploading = 0;
  let timer = 0;

  const changed = () => current() !== saved || (mode === 'new' && JSON.stringify(readMetaForm()) !== savedMeta);

  function showState(text: string) {
    stateLabel.textContent = text;
    saveButton.disabled = !dirty || saving || uploading > 0;
  }

  /** بعد أن يهدأ الكاتب: هل بقي فرق عن المحفوظ؟ إن بقي تُكتب النسخة الاحتياطية */
  async function settle() {
    dirty = changed();
    if (!dirty) {
      await clearDraft(draftKey);
      return showState('لا تغييرات');
    }
    const at = Date.now();
    const draft: Draft = { slug: draftKey, html: current(), base, at };
    if (mode === 'new') Object.assign(draft, { id: postId, meta: readMetaForm() });
    const stored = await writeDraft(draft);
    const pending = mode === 'new' ? 'لم تُنشر بعد' : 'تغييرات غير محفوظة';
    showState(stored === undefined ? pending : `${pending} · نسخة احتياطية على هذا الجهاز ${clock(at)}`);
  }

  function touched() {
    dirty = true;
    showState(mode === 'new' ? 'لم تُنشر بعد' : 'تغييرات غير محفوظة');
    window.clearTimeout(timer);
    timer = window.setTimeout(settle, SETTLE_MS);
  }

  editor.on('update', touched);
  metaForm?.addEventListener('input', touched);
  metaForm?.addEventListener('change', touched);
  metaForm?.addEventListener('submit', (event) => event.preventDefault());

  window.addEventListener('beforeunload', (event) => {
    if (dirty || uploading > 0) event.preventDefault();
  });

  showState(mode === 'new' ? 'ابدأ بالعنوان ثم النص' : 'لا تغييرات');

  // نسخة احتياطية من جلسة سابقة انقطعت
  const draft = await readDraft(draftKey);
  if (draft && (draft.html !== saved || (mode === 'new' && draft.meta && JSON.stringify(draft.meta) !== savedMeta))) {
    const moved = mode === 'edit' && draft.base !== base ? ' تنبيه: نص التدوينة على الموقع تغيّر بعدها، فراجع قبل الحفظ.' : '';
    const what = mode === 'new' ? 'تدوينة جديدة لم تُنشر' : 'تعديلات لم تُحفظ';
    announce(`على هذا الجهاز ${what} من ${clock(draft.at)}.${moved}`, 'info', [
      [
        'استرجاعها',
        () => {
          editor.commands.setContent(parseBody(expandRawBlocks(draft.html), document).toJSON());
          if (mode === 'new') {
            if (draft.meta) fillMetaForm(draft.meta);
            if (draft.id) postId = draft.id;
          }
          notice.hidden = true;
          touched();
        },
      ],
      [
        'تجاهلها',
        () => {
          void clearDraft(draftKey);
          notice.hidden = true;
        },
      ],
    ]);
  }

  // ── الحفظ (تدوينة قائمة) ───────────────────────────────────────────────────

  async function save() {
    if (saving || uploading > 0) return;
    window.clearTimeout(timer);
    const html = current();
    if (html === saved) {
      dirty = false;
      return showState('لا تغييرات');
    }
    saving = true;
    showState('جارٍ الحفظ…');
    try {
      const response = await fetch(`/api/studio/posts/${encodeURIComponent(slug)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ ...splitRawBlocks(html), base }),
      });
      const result = (await response.json()) as { commit?: string; base?: string; live?: boolean; unchanged?: boolean; error?: string };
      if (!response.ok) throw new Error(result.error);

      saved = html;
      dirty = current() !== saved;
      await clearDraft(draftKey);
      if (result.commit) {
        base = result.base!;
        announce('تم الحفظ ✓', 'saved');
        const status = document.createElement('span');
        status.dataset.deployText = '';
        status.textContent = result.live ? 'جارٍ النشر على الموقع…' : 'هذا فرع تجربة: التعديل محفوظ ولا يُنشر على الموقع.';
        notice.append(status);
        if (result.live) {
          notice.dataset.deploySha = result.commit;
          watchDeploy(notice);
        }
      }
      saving = false;
      showState(dirty ? 'تغييرات غير محفوظة' : 'لا تغييرات');
    } catch (err) {
      saving = false;
      dirty = true;
      announce(err instanceof Error && err.message ? err.message : 'تعذّر الحفظ. تحقق من الاتصال وحاول مرة أخرى.', 'error');
      showState('لم يُحفظ — تعديلاتك باقية هنا');
    }
  }

  // ── النشر (تدوينة جديدة) ───────────────────────────────────────────────────

  async function publish() {
    if (saving || uploading > 0) return;
    window.clearTimeout(timer);
    clearFieldErrors();
    const meta = readMetaForm();
    const html = current();

    const local: Record<string, string> = {};
    if (!String(meta.title).trim()) local.title = 'اكتب عنوان التدوينة.';
    if (!html) local.body = 'اكتب نص التدوينة.';
    if (Object.keys(local).length > 0) {
      showFieldErrors(local);
      return announce('ينقص التدوينة ما هو معلَّم بالأحمر.', 'error');
    }

    const type = String(meta.type);
    const classification =
      type === 'travel'
        ? { type, countries: [String(meta.country), ...(meta.countries as string[])].filter(Boolean) }
        : type === 'other'
          ? { type, category: String(meta.category) }
          : { type: 'none' };

    saving = true;
    showState('جارٍ النشر…');
    try {
      await settle();
      const response = await fetch('/api/studio/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          id: postId,
          title: meta.title,
          date: meta.date,
          labels: String(meta.labels).split(/\r?\n/),
          classification,
          ...splitRawBlocks(html),
        }),
      });
      const result = (await response.json()) as { slug?: string; commit?: string; exists?: boolean; errors?: Record<string, string>; error?: string };

      if (result.slug && (response.status === 201 || result.exists)) {
        dirty = false;
        await clearDraft(draftKey);
        const after = result.commit ? `?saved=${result.commit}&new=1` : '';
        window.location.assign(`/studio/post/${encodeURIComponent(result.slug)}${after}`);
        return;
      }
      if (result.errors) {
        showFieldErrors(result.errors);
        throw new Error('ينقص التدوينة ما هو معلَّم بالأحمر.');
      }
      throw new Error(result.error);
    } catch (err) {
      saving = false;
      dirty = true;
      announce(err instanceof Error && err.message ? err.message : 'تعذّر النشر. تحقق من الاتصال وحاول مرة أخرى.', 'error');
      showState('لم تُنشر — ما كتبته باقٍ هنا وعلى هذا الجهاز');
    }
  }

  // ── الصور ──────────────────────────────────────────────────────────────────

  async function uploadImages(files: File[]) {
    uploading += 1;
    showState('جارٍ رفع الصور…');
    const failed: string[] = [];
    for (const [index, file] of files.entries()) {
      announce(files.length > 1 ? `جارٍ رفع الصورة ${index + 1} من ${files.length}…` : 'جارٍ رفع الصورة…', 'info');
      try {
        const { full, thumb } = await prepareImage(file);
        const form = new FormData();
        form.append('full', full, 'full.jpg');
        form.append('thumb', thumb, 'thumb.jpg');
        const response = await fetch('/api/studio/media', { method: 'POST', body: form, headers: { Accept: 'application/json' } });
        const result = (await response.json()) as { src?: string; thumb?: string; error?: string };
        if (!response.ok || !result.src) throw new Error(result.error);
        editor
          .chain()
          .focus()
          .insertContent({ type: 'paragraph', content: [{ type: 'image', attrs: { src: result.src, thumb: result.thumb, alt: '', loading: 'lazy' } }] })
          .run();
      } catch (err) {
        failed.push(err instanceof Error && err.message ? err.message : `تعذّر رفع «${file.name}».`);
      }
    }
    uploading -= 1;
    if (failed.length > 0) announce(failed.join(' '), 'error');
    else notice.hidden = true;
    showState(dirty ? (mode === 'new' ? 'لم تُنشر بعد' : 'تغييرات غير محفوظة') : 'لا تغييرات');
  }

  fileInput.addEventListener('change', () => {
    const files = [...(fileInput.files ?? [])];
    fileInput.value = '';
    if (files.length > 0) void uploadImages(files);
  });

  // ── المعاينة ───────────────────────────────────────────────────────────────

  function openPreview() {
    const holder = document.createElement('div');
    holder.innerHTML = expandRawBlocks(current());
    // المعاينة إطار معزول لا تعمل فيه السكربتات، فمشغّل يوتيوب لا يظهر داخله
    for (const frame of holder.querySelectorAll('iframe')) {
      const stand = document.createElement('p');
      stand.className = 'studio-preview-video';
      stand.textContent = 'مقطع مضمَّن — يعمل على الموقع ولا يُعرض في المعاينة';
      frame.replaceWith(stand);
    }
    if (mode === 'new') {
      const heading = document.createElement('h1');
      heading.className = 'studio-preview-title';
      heading.textContent = String(readMetaForm().title).trim();
      holder.prepend(heading);
    }
    const styles = [...document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')]
      .map((link) => `<link rel="stylesheet" href="${link.href}">`)
      .join('');
    const frame = preview.querySelector('iframe')!;
    frame.srcdoc =
      `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">` +
      `<meta name="viewport" content="width=device-width, initial-scale=1">${styles}</head>` +
      `<body style="margin:0; background:#f0e6d2;"><main style="max-width:48rem; margin:0 auto; padding:1.5rem 1rem 4rem;">` +
      `<div class="post-content">${holder.innerHTML}</div></main></body></html>`;
    preview.showModal();
  }

  // ── شريط الأدوات ───────────────────────────────────────────────────────────

  const chain = () => editor.chain().focus();
  const centered = () => editor.isActive({ align: 'center' });

  const commands: Record<string, (value: string) => void> = {
    undo: () => chain().undo().run(),
    redo: () => chain().redo().run(),
    bold: () => chain().toggleBold().run(),
    italic: () => chain().toggleItalic().run(),
    underline: () => chain().toggleUnderline().run(),
    strike: () => chain().toggleStrike().run(),
    clear: () => chain().unsetAllMarks().run(),
    color: (value) => (value ? chain().setMark('textColor', { color: value }).run() : chain().unsetMark('textColor').run()),
    quote: () => chain().toggleBlockquote().run(),
    rule: () => chain().setHorizontalRule().run(),
    bullets: () => chain().toggleBulletList().run(),
    numbers: () => chain().toggleOrderedList().run(),
    center: () => {
      const align = centered() ? null : 'center';
      chain().updateAttributes('paragraph', { align }).updateAttributes('heading', { align }).run();
    },
    image: () => {
      if (root.dataset.media !== 'on') return announce('رفع الصور غير مفعّل بعد. أخبر عبيد.', 'error');
      fileInput.click();
    },
    alt: () => {
      altInput.value = editor.getAttributes('image').alt ?? '';
      altBar.hidden = false;
      altInput.focus();
    },
    'alt-apply': () => {
      chain().updateAttributes('image', { alt: altInput.value.replace(/\s+/g, ' ').trim() }).run();
      altBar.hidden = true;
    },
    'alt-close': () => {
      altBar.hidden = true;
      editor.commands.focus();
    },
    link: () => {
      linkInput.value = editor.getAttributes('link').href ?? '';
      linkBar.hidden = false;
      linkInput.focus();
    },
    'link-apply': () => {
      const typed = linkInput.value.trim();
      if (!typed) return commands['link-remove']('');
      const href = /^(https?:|mailto:|tel:)/i.test(typed) ? typed : `https://${typed}`;
      chain().extendMarkRange('link').setLink({ href }).run();
      linkBar.hidden = true;
    },
    'link-remove': () => {
      chain().extendMarkRange('link').unsetLink().run();
      linkBar.hidden = true;
    },
    'link-close': () => {
      linkBar.hidden = true;
      editor.commands.focus();
    },
    'delete-selected': () => chain().deleteSelection().run(),
    preview: openPreview,
    'close-preview': () => preview.close(),
    save: () => void (mode === 'new' ? publish() : save()),
  };

  // الأزرار لا تسرق التحديد من النص: الضغط عليها لا ينقل التركيز
  for (const area of [toolbar, selectedBar]) {
    area.addEventListener('mousedown', (event) => {
      if ((event.target as HTMLElement).closest('button')) event.preventDefault();
    });
  }
  for (const area of [root, preview]) {
    area.addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-cmd]');
      if (button) commands[button.dataset.cmd!]?.(button.dataset.value ?? '');
    });
  }
  for (const [input, command] of [
    [linkInput, 'link-apply'],
    [altInput, 'alt-apply'],
  ] as const) {
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        commands[command]('');
      }
    });
  }

  sizeSelect.addEventListener('change', () => {
    if (sizeSelect.value) chain().setMark('fontSize', { size: sizeSelect.value }).run();
    else chain().unsetMark('fontSize').run();
  });
  blockSelect.addEventListener('change', () => {
    if (blockSelect.value === 'h2') chain().setHeading({ level: 2 }).run();
    else if (blockSelect.value === 'h3') chain().setHeading({ level: 3 }).run();
    else chain().setParagraph().run();
  });

  /** اللون كما يكتبه المتصفح (‎rgb(…)‎): المحفوظ يعود بهذه الصيغة، وأزرار الشريط بصيغة ‎#rrggbb‎ */
  const probe = document.createElement('span');
  const sameColor = (a: string, b: string) => {
    if (!a || !b) return a === b;
    probe.style.color = a;
    const first = probe.style.color;
    probe.style.color = b;
    return first === probe.style.color;
  };

  const SELECTED_NAMES: Record<string, string> = { image: 'صورة محدَّدة', rawBlock: 'عنصر محدَّد', horizontalRule: 'فاصل محدَّد' };

  /** حالة الأزرار تتبع موضع المؤشّر */
  function refresh() {
    const active: Record<string, boolean> = {
      bold: editor.isActive('bold'),
      italic: editor.isActive('italic'),
      underline: editor.isActive('underline'),
      strike: editor.isActive('strike'),
      quote: editor.isActive('blockquote'),
      bullets: editor.isActive('bulletList'),
      numbers: editor.isActive('orderedList'),
      center: centered(),
      link: editor.isActive('link'),
    };
    for (const button of toolbar.querySelectorAll<HTMLButtonElement>('button[data-cmd]')) {
      const name = button.dataset.cmd!;
      if (name === 'color') {
        button.setAttribute('aria-pressed', String(sameColor(editor.getAttributes('textColor').color ?? '', button.dataset.value ?? '')));
      } else if (name in active) {
        button.setAttribute('aria-pressed', String(active[name]));
      } else if (name === 'undo') {
        button.disabled = !editor.can().undo();
      } else if (name === 'redo') {
        button.disabled = !editor.can().redo();
      }
    }

    // حجم من الأرشيف خارج الخيارات الأربعة (‎large‎، ‎12pt‎…) يظهر «حجم قديم» ولا يُغيَّر إلا باختيار
    const size: string = editor.getAttributes('fontSize').size ?? '';
    const legacy = sizeSelect.querySelector<HTMLOptionElement>('option[data-legacy]')!;
    const known = [...sizeSelect.options].some((option) => !option.dataset.legacy && option.value === size);
    legacy.hidden = known;
    legacy.value = known ? '__legacy' : size;
    sizeSelect.value = size;

    blockSelect.value = editor.isActive('heading', { level: 2 }) ? 'h2' : editor.isActive('heading', { level: 3 }) ? 'h3' : 'p';

    const node = (editor.state.selection as { node?: { type: { name: string } } }).node;
    const name = node ? SELECTED_NAMES[node.type.name] : undefined;
    // قبل أن يدخل الكاتب المحرّر يقف التحديد على أول عنصر تلقائياً — ليس اختياراً منه
    // خانة وصف الصورة تأخذ التركيز من المحرّر، والشريط يبقى ما دامت مفتوحة
    selectedBar.hidden = !name || (!editor.isFocused && altBar.hidden);
    if (name) selectedBar.querySelector('span')!.textContent = name;
    altButton.hidden = node?.type.name !== 'image';
    if (node?.type.name !== 'image') altBar.hidden = true;
  }

  editor.on('transaction', refresh);
  editor.on('focus', refresh);
  editor.on('blur', refresh);
  refresh();
  root.dataset.ready = '';
}

// في آخر الملف: start تعمل فوراً حتى أول await، وتحتاج كل ما فوقها معرَّفاً
const root = document.querySelector<HTMLElement>('[data-studio-editor]');
if (root) void start(root);
