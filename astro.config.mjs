// @ts-check
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';
import vercel from '@astrojs/vercel';
import { studioIndex } from './src/lib/studio/index-plugin.mjs';

// https://astro.build/config
export default defineConfig({
  // الموقع ساكن كما كان. المحوّل موجود لصفحات لوحة التحرير (/studio) وحدها —
  // هي الوحيدة التي تحمل `prerender = false` وتُعرض من الخادم.
  output: 'static',
  adapter: vercel(),

  security: {
    // بدون هذه القائمة يتجاهل Astro ترويسة Host ويعتبر العنوان «localhost»، فيرفض فحصُ
    // Origin كل طلب كتابة من اللوحة (403). عند ربط نطاق خاص بالموقع أضِفه هنا.
    allowedDomains: [
      { hostname: 'blog-rahal.vercel.app', protocol: 'https' },
      { hostname: 'localhost', protocol: 'http' },
      { hostname: '127.0.0.1', protocol: 'http' },
    ],
    // فحص Origin المدمج في Astro يعمل قبل src/middleware.ts ويردّ «Cross-site POST form submissions
    // are forbidden» (403) على أي طلب كتابة بلا Origin مطابق — حتى من زائر غير مقترن، بينما أي عنوان
    // غير موجود يردّ 404. هذا الفرق يكشف أن مسارات /studio موجودة (ظهر على الموقع الحيّ 2026-11-21).
    // الوسيط يفحص بنفسه، وأشدّ: كل طلب كتابة من جهاز مقترن يحتاج Sec-Fetch-Site و Origin مطابقين.
    checkOrigin: false,
  },

  vite: {
    plugins: [tailwindcss(), studioIndex()]
  }
});
