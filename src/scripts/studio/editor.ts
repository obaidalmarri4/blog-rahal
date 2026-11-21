/**
 * محرّر نص التدوينة (‎/studio/edit/<slug>‎).
 *
 * يحمّل النص طازجاً من ‎/api/studio/posts/<slug>‎، يفتحه في TipTap بمخطط اللوحة، ويحفظه بطلب
 * PUT. التحميل والتسلسل بدوال src/lib/studio/document.js نفسها التي تختبرها البوابات — لا
 * بدوال TipTap النصّية.
 */

import { Editor } from '@tiptap/core';
import { bodyForSave, loadBody, parseBody } from '../../lib/studio/document.js';
import { cleanPastedHTML } from '../../lib/studio/paste.js';
import { expandRawBlocks, splitRawBlocks } from '../../lib/studio/raw-blocks.js';
import { RawBlock, studioExtensions } from '../../lib/studio/schema.js';
import { watchDeploy } from './deploy-status.ts';
import { clearDraft, readDraft, writeDraft } from './drafts.ts';

const root = document.querySelector<HTMLElement>('[data-studio-editor]');
if (root) void start(root);

const SETTLE_MS = 1500;

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

async function start(root: HTMLElement) {
  const slug = root.dataset.slug!;
  const api = `/api/studio/posts/${encodeURIComponent(slug)}`;
  const query = <T extends HTMLElement>(selector: string) => root.querySelector<T>(selector)!;

  const mount = query('[data-editor-mount]');
  const notice = query('[data-editor-notice]');
  const stateLabel = query('[data-editor-state]');
  const saveButton = query<HTMLButtonElement>('[data-cmd="save"]');
  const toolbar = query('[data-editor-toolbar]');
  const linkBar = query('[data-editor-linkbar]');
  const linkInput = query<HTMLInputElement>('[data-editor-linkbar] input');
  const selectedBar = query('[data-editor-selected]');
  const sizeSelect = query<HTMLSelectElement>('[data-select="size"]');
  const blockSelect = query<HTMLSelectElement>('[data-select="block"]');
  const preview = document.querySelector<HTMLDialogElement>('[data-editor-preview]')!;

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
  }

  // ── التحميل ────────────────────────────────────────────────────────────────

  let body: { title: string; html: string; base: string; locked: boolean; error?: string };
  try {
    const response = await fetch(api, { headers: { Accept: 'application/json' } });
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

  let base = body.base;
  mount.replaceChildren();

  const editor = new Editor({
    element: mount,
    extensions: studioExtensions.map((extension) => (extension.name === 'rawBlock' ? RawBlockView : extension)),
    content: loadBody(body.html, document).doc.toJSON(),
    editorProps: {
      attributes: { class: 'post-content studio-page', dir: 'rtl', 'aria-label': 'نص التدوينة' },
      transformPastedHTML: (html) => cleanPastedHTML(html, document),
    },
  });

  const current = () => bodyForSave(editor.state.doc, document);
  /** ما في المستودع الآن، بتسلسل هذا المحرّر — «تغيّر شيء؟» تُقاس عليه */
  let saved = current();
  let dirty = false;
  let saving = false;
  let timer = 0;

  function showState(text: string) {
    stateLabel.textContent = text;
    saveButton.disabled = !dirty || saving;
  }

  /** بعد أن يهدأ الكاتب: هل بقي فرق عن المحفوظ؟ إن بقي تُكتب النسخة الاحتياطية */
  async function settle() {
    const html = current();
    dirty = html !== saved;
    if (!dirty) {
      await clearDraft(slug);
      return showState('لا تغييرات');
    }
    const at = Date.now();
    const stored = await writeDraft({ slug, html, base, at });
    showState(stored === undefined ? 'تغييرات غير محفوظة' : `تغييرات غير محفوظة · نسخة احتياطية على هذا الجهاز ${clock(at)}`);
  }

  editor.on('update', () => {
    dirty = true;
    showState('تغييرات غير محفوظة');
    window.clearTimeout(timer);
    timer = window.setTimeout(settle, SETTLE_MS);
  });

  window.addEventListener('beforeunload', (event) => {
    if (dirty) event.preventDefault();
  });

  showState('لا تغييرات');

  // نسخة احتياطية من جلسة سابقة انقطعت
  const draft = await readDraft(slug);
  if (draft && draft.html !== saved) {
    const moved = draft.base !== base ? ' تنبيه: نص التدوينة على الموقع تغيّر بعدها، فراجع قبل الحفظ.' : '';
    announce(`على هذا الجهاز تعديلات لم تُحفظ من ${clock(draft.at)}.${moved}`, 'info', [
      [
        'استرجاعها',
        () => {
          editor.commands.setContent(parseBody(expandRawBlocks(draft.html), document).toJSON());
          notice.hidden = true;
        },
      ],
      [
        'تجاهلها',
        () => {
          void clearDraft(slug);
          notice.hidden = true;
        },
      ],
    ]);
  }

  // ── الحفظ ──────────────────────────────────────────────────────────────────

  async function save() {
    if (saving) return;
    window.clearTimeout(timer);
    const html = current();
    if (html === saved) {
      dirty = false;
      return showState('لا تغييرات');
    }
    saving = true;
    showState('جارٍ الحفظ…');
    try {
      const response = await fetch(api, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ ...splitRawBlocks(html), base }),
      });
      const result = (await response.json()) as { commit?: string; base?: string; live?: boolean; unchanged?: boolean; error?: string };
      if (!response.ok) throw new Error(result.error);

      saved = html;
      dirty = current() !== saved;
      await clearDraft(slug);
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
    save: () => void save(),
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
  linkInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commands['link-apply']('');
    }
  });

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
    selectedBar.hidden = !name || !editor.isFocused;
    if (name) selectedBar.querySelector('span')!.textContent = name;
  }

  editor.on('transaction', refresh);
  editor.on('focus', refresh);
  editor.on('blur', refresh);
  refresh();
  root.dataset.ready = '';
}
