// @ts-check
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';
import vercel from '@astrojs/vercel';

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
  },

  vite: {
    plugins: [tailwindcss()]
  }
});
