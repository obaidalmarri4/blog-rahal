/**
 * فاحص جسم التدوينة في الخادم: ما يرسله المحرّر لا يُحفظ حتى يثبت أنه مما يستطيع المحرّر كتابته.
 *
 * لماذا والمحرِّر موثوق: حماية اللوحة رابط سرّي. لو تسرّب يوماً، يستطيع حامله أن يرسل للخادم أي
 * HTML بلا محرّر — ووسم ‎<script>‎ واحد في تدوينة يعمل عند كل زائر للموقع. هنا يُغلق ذلك.
 *
 * القاعدة: **قائمة مسموحات، والرفض لا التنظيف.**
 *   - خارج الكتل المحفوظة: الوسوم والسمات التي ينتجها مخطط المحرّر فقط (schema.js). القائمة
 *     مبنية على إحصاء ناتج المخطط على الـ466 تدوينة، وscripts/studio-editor-check.mjs يثبت أن
 *     كل تدوينة في الأرشيف تمرّ منها.
 *   - الكتل المحفوظة (جداول، مقاطع… محتوى قديم لا يُفحص وسماً وسماً): تُقبل الكتلة فقط إن كانت
 *     موجودة أصلاً في النسخة المخزَّنة من التدوينة نفسها. المحرّر ينقلها ويحذفها ولا يؤلّفها.
 *   - أي شيء آخر يرفض الحفظ كله. محرّر سليم لا يُنتجه، فتنظيفه بصمت يخفي خللاً أو عبثاً.
 *
 * وما يُخزَّن هو تسلسل الشجرة المفحوصة لا النص المرسَل: لا يصل المستودعَ حرف لم يقرأه المحلِّل.
 *
 * دوال خالصة (parse5 فقط).
 */

import { defaultTreeAdapter as tree, html as htmlSpec, parseFragment, serialize, serializeOuter } from 'parse5';
import type { DefaultTreeAdapterTypes } from 'parse5';
import { RAW_BLOCK_TAGS, SAFE_CSS_VALUE } from './raw-blocks.js';

type ParentNode = DefaultTreeAdapterTypes.ParentNode;
type ChildNode = DefaultTreeAdapterTypes.ChildNode;
type Element = DefaultTreeAdapterTypes.Element;

export type BodyCheck = { ok: true; html: string } | { ok: false; reason: string };

type AttributeRule = (value: string) => boolean;

const RAW_TAGS = new Set<string>(RAW_BLOCK_TAGS);

/** نفس ما يتجاهله المتصفح داخل مخطط العنوان: ‎"java\tscript:"‎ يقرؤه المتصفح ‎javascript:‎ */
const URL_WHITESPACE = /[\u0000-\u0020\u00A0\u1680\u180E\u2000-\u2029\u205F\u3000]/g;

function scheme(url: string): string | null {
  return /^([a-z][a-z0-9+.-]*):/i.exec(url.replace(URL_WHITESPACE, ''))?.[1].toLowerCase() ?? null;
}

/** نفس مخططات إضافة الرابط في TipTap — ما يقبله المحرّر يقبله الخادم */
const LINK_SCHEMES = ['http', 'https', 'ftp', 'ftps', 'mailto', 'tel', 'callto', 'sms', 'cid', 'xmpp'];
/** في الأرشيف 18 صورة بروابط ‎file:‎ و ‎blob:‎ (لصق من Word): ميتة ولا تؤذي، ورفضها يمنع حفظ تدويناتها */
const IMAGE_SCHEMES = ['http', 'https', 'file', 'blob'];

const within = (schemes: string[]): AttributeRule => (value) => {
  const found = scheme(value);
  return found === null || schemes.includes(found);
};
const matching = (pattern: RegExp): AttributeRule => (value) => pattern.test(value);
const upTo = (length: number): AttributeRule => (value) => value.length <= length;

const STYLE_PROPERTIES = ['font-size', 'color', 'background-color'];

/** ‎style‎ على ‎<span>‎: تصريح واحد لكل خاصية من الثلاث، بقيمة آمنة */
const spanStyle: AttributeRule = (value) => {
  const declarations = value.split(';').map((part) => part.trim()).filter(Boolean);
  if (declarations.length === 0 || declarations.length > STYLE_PROPERTIES.length) return false;
  return declarations.every((declaration) => {
    const colon = declaration.indexOf(':');
    const property = declaration.slice(0, colon).trim().toLowerCase();
    const propertyValue = declaration.slice(colon + 1).trim();
    return colon > 0 && STYLE_PROPERTIES.includes(property) && SAFE_CSS_VALUE.test(propertyValue) && !/url|expression/i.test(propertyValue);
  });
};

const TEXT_BLOCK: Record<string, AttributeRule> = {
  'data-align': (value) => value === 'center',
  dir: (value) => value === 'ltr',
};
const NO_ATTRIBUTES: Record<string, AttributeRule> = {};
/** في الأرشيف مقاسات بكسور طويلة مثل ‎574.4621340887629‎ */
const DIMENSION = matching(/^[\d.]{1,24}(px|%)?$/);

/** كل وسم يكتبه المحرّر، وما يُسمح به من سمات عليه */
const ALLOWED: Record<string, Record<string, AttributeRule>> = {
  p: TEXT_BLOCK,
  h1: TEXT_BLOCK,
  h2: TEXT_BLOCK,
  h3: TEXT_BLOCK,
  h4: TEXT_BLOCK,
  h5: TEXT_BLOCK,
  h6: TEXT_BLOCK,
  br: NO_ATTRIBUTES,
  hr: NO_ATTRIBUTES,
  strong: NO_ATTRIBUTES,
  em: NO_ATTRIBUTES,
  u: NO_ATTRIBUTES,
  s: NO_ATTRIBUTES,
  sup: NO_ATTRIBUTES,
  sub: NO_ATTRIBUTES,
  blockquote: NO_ATTRIBUTES,
  ul: NO_ATTRIBUTES,
  li: NO_ATTRIBUTES,
  ol: { start: matching(/^\d{1,6}$/), type: matching(/^[1aAiI]$/) },
  span: { style: spanStyle },
  a: {
    href: within(LINK_SCHEMES),
    target: matching(/^_{1,2}[a-z]{1,12}$/i),
    rel: matching(/^[\w\s[\]:.-]{0,120}$/),
    title: upTo(1000),
  },
  img: {
    src: within(IMAGE_SCHEMES),
    'data-thumb': within(IMAGE_SCHEMES),
    alt: upTo(4000),
    title: upTo(1000),
    width: DIMENSION,
    height: DIMENSION,
    loading: (value) => value === 'lazy' || value === 'eager',
  },
};

/** التحليل في سياق ‎<body>‎: نفس سياق المحرّر في المتصفح، فالشجرتان واحدة */
function parse(html: string): ParentNode {
  return parseFragment(tree.createElement('body', htmlSpec.NS.HTML, []), html);
}

const isElement = (node: ChildNode): node is Element => 'tagName' in node;

/**
 * الشكل الثابت لكتلة محفوظة: تُحلَّل وتُسلسَل حتى لا يتغيّر الناتج. المقارنة تجري على هذا الشكل
 * لا على النص الخام، لأن التسلسل ليس ثابتاً من أول مرة دائماً (‎<pre>‎ يفقد سطره الأول في كل
 * مرور)، والمتصفح مرّ على الكتلة مرتين قبل أن يرسلها.
 * يعيد null إن لم يكن النص عنصراً واحداً من وسوم الكتل المحفوظة.
 */
function settleRawBlock(html: string): string | null {
  let current = html;
  for (let pass = 0; pass < 6; pass++) {
    const nodes = parse(current).childNodes;
    if (nodes.length !== 1 || !isElement(nodes[0]) || !RAW_TAGS.has(nodes[0].tagName)) return null;
    const next = serializeOuter(nodes[0]);
    if (next === current) return current;
    current = next;
  }
  return null;
}

/** الكتل المحفوظة الموجودة في النسخة المخزَّنة — الأبعد فالأبعد، فما بداخل كتلة جزء منها */
function storedRawBlocks(storedHtml: string): Set<string> {
  const blocks = new Set<string>();
  const visit = (parent: ParentNode) => {
    for (const node of parent.childNodes) {
      if (!isElement(node)) continue;
      if (RAW_TAGS.has(node.tagName)) {
        const settled = settleRawBlock(serializeOuter(node));
        if (settled !== null) blocks.add(settled);
      } else {
        visit(node);
      }
    }
  };
  visit(parse(storedHtml));
  return blocks;
}

const PLACEHOLDER = /<div data-raw-block="(\d+)"><\/div>/g;

/**
 * @param html ما أرسله المحرّر: الكتل المحفوظة فيه ‎<div data-raw-block="رقم">‎
 * @param raw نصوص الكتل المحفوظة بترتيب أرقامها
 * @param storedHtml ‎content_html‎ المخزَّن الآن لهذه التدوينة
 * @returns الجسم الموسَّع الجاهز للتخزين، أو سبب الرفض (للسجل، لا للعرض)
 */
export function checkBody(html: string, raw: string[], storedHtml: string): BodyCheck {
  let allowedBlocks: Set<string> | null = null;
  let reason: string | null = null;

  const visit = (parent: ParentNode) => {
    for (const node of parent.childNodes) {
      if (reason) return;
      if (tree.isTextNode(node)) continue;
      if (!isElement(node)) {
        reason = `node:${node.nodeName}`;
        return;
      }

      if (node.tagName === 'div') {
        const index = node.attrs.length === 1 && node.attrs[0].name === 'data-raw-block' ? node.attrs[0].value : '';
        if (!/^\d{1,5}$/.test(index) || node.childNodes.length > 0 || Number(index) >= raw.length) {
          reason = 'raw:placeholder';
          return;
        }
        const settled = settleRawBlock(raw[Number(index)]);
        allowedBlocks ??= storedRawBlocks(storedHtml);
        if (settled === null || !allowedBlocks.has(settled)) {
          reason = 'raw:unknown';
          return;
        }
        continue;
      }

      const rules = Object.hasOwn(ALLOWED, node.tagName) ? ALLOWED[node.tagName] : null;
      if (!rules || node.namespaceURI !== htmlSpec.NS.HTML) {
        reason = `tag:${node.tagName}`;
        return;
      }
      for (const attribute of node.attrs) {
        if (!Object.hasOwn(rules, attribute.name) || !rules[attribute.name](attribute.value)) {
          reason = `attribute:${node.tagName}[${attribute.name}]`;
          return;
        }
      }
      visit(node);
    }
  };

  if (!Array.isArray(raw) || raw.some((block) => typeof block !== 'string')) return { ok: false, reason: 'raw:shape' };

  const fragment = parse(html);
  visit(fragment);
  if (reason) return { ok: false, reason };

  return { ok: true, html: serialize(fragment).replace(PLACEHOLDER, (_, index) => raw[Number(index)]) };
}
