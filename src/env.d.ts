declare namespace App {
  interface Locals {
    /**
     * يضعها src/middleware.ts وحده بعد التحقق:
     *   'paired'   — الجهاز مقترن (كوكي صالحة).
     *   'entering' — الطلب يحمل المفتاح الصحيح في رابط الاقتران.
     * غيابها يعني أن الطلب لم يمرّ بالحارس — صفحات اللوحة ترفضه.
     */
    studio?: 'paired' | 'entering';
  }
}
