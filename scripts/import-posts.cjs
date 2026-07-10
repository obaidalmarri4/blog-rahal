#!/usr/bin/env node
/**
 * سكربت استيراد البيانات المسحوبة إلى مشروع Astro
 * يقرأ all_posts.json وينسخ الملفات والصور
 */

const fs = require('fs');
const path = require('path');

// مخرجات الـ scraper بقيت في الفولدر الأصلي بعد نقل المشروع لسطح المكتب
const SOURCE_DATA = '/Users/obaidalmarri/blog rahal/output/all_posts.json';
const SOURCE_IMAGES = '/Users/obaidalmarri/blog rahal/data/images';
const DEST_POSTS = path.join(__dirname, '../src/content/posts');
const DEST_IMAGES = path.join(__dirname, '../public/images');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function cleanSlug(slug) {
  return slug.replace(/\.html$/, '').replace(/\//g, '-');
}

function main() {
  console.log('📥 جاري استيراد البيانات...');

  // Read source data
  if (!fs.existsSync(SOURCE_DATA)) {
    console.error('❌ ملف البيانات غير موجود:', SOURCE_DATA);
    process.exit(1);
  }

  const posts = JSON.parse(fs.readFileSync(SOURCE_DATA, 'utf-8'));
  console.log(`📄 عدد التدوينات: ${posts.length}`);

  ensureDir(DEST_POSTS);
  ensureDir(DEST_IMAGES);

  let totalImages = 0;
  let copiedImages = 0;

  for (let i = 0; i < posts.length; i++) {
    const post = posts[i];
    const slug = cleanSlug(post.slug);

    // Images use original Blogger URLs (hosted on Google CDN)
    // No need to copy images locally
    if (post.images) {
      totalImages += post.images.filter(img => img.original_url).length;
    }

    // Save post as JSON
    const filename = `${String(i + 1).padStart(4, '0')}_${slug}.json`;
    fs.writeFileSync(
      path.join(DEST_POSTS, filename),
      JSON.stringify(post, null, 2),
      'utf-8'
    );
  }

  console.log(`✅ تم استيراد ${posts.length} تدوينة`);
  console.log(`🖼️  صور: ${copiedImages} نُسخت من أصل ${totalImages}`);
  console.log(`💾 التدوينات في: ${DEST_POSTS}`);
  console.log(`🖼️  الصور في: ${DEST_IMAGES}`);
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

main();
