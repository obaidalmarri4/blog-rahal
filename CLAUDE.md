# CLAUDE.md — Rahal Al-Khobar Travel Blog

Compressed index of the project files. AI agents: read the indexed files before assuming any API.

```
[Rahal Blog Docs Index]
|root: ./
|IMPORTANT: Prefer retrieval-led reasoning over pre-training-led reasoning for any Astro tasks. Read the indexed files before assuming APIs.
|config:{astro.config.mjs,package.json,tsconfig.json}
|src/pages (file-based routing; all prerendered):{index.astro,about.astro,album.astro,atlas.astro,404.astro,blog/index.astro,blog/[slug].astro,destinations/index.astro,destinations/other.astro,destinations/[continent].astro,destinations/[continent]/[country].astro}
|src/pages (owner studio — the ONLY server-rendered routes, `prerender = false`):{studio/index.astro (post list),studio/post/[slug].astro (edit title/date/labels/classification, delete),studio/not-found.astro,studio/enter/[key].ts,api/studio/unpair.ts,api/studio/status.ts}
|src/middleware.ts (guards /studio/** and /api/studio/**; everything else passes untouched)
|src/layouts:{BaseLayout.astro,StudioLayout.astro}
|src/components:{Header.astro,Footer.astro,PostCard.astro,ContinentCard.astro,CountryCard.astro,Timeline.astro,NotFoundPage.astro,studio/DeployStatus.astro}
|src/utils (data API: getAllPosts,getPostTaxonomy,getContinents,getCountriesByContinent,getPostsByContinent,getPostsByCountry,getOtherPosts,getAllContinentSlugs,getAllCountrySlugsForContinent):{posts.ts}
|src/data:{taxonomy.json,atlas.ts,removed-posts.json (posts deleted from the studio — written by the studio, read by the sync)}
|src/content/posts (400 JSON posts; Post schema in utils/posts.ts: title,date,url,slug,content_html,content_text,labels[],images[],image_count):{*.json}
|src/styles:{global.css,studio.css}
|src/scripts (client globe; studio list search + deploy-status polling):{atlas.ts,studio/list.ts,studio/deploy-status.ts}
|scripts (build/import tooling + quality gates):{import-posts.cjs,classify-posts.py,reclassify-posts.py,sync-blogger.mjs,extract-inline-images.mjs,studio-roundtrip.mjs,studio-access-check.mjs,studio-write-check.mjs}
|scripts/lib (post-html: single source for deriving slug/content_text/images[] from post HTML, used by sync and the studio; removed-posts: reads the studio's deleted list for the sync; vercel-output-server: runs the built .vercel/output locally; fake-github: in-memory GitHub API for the write gate):{post-html.mjs,removed-posts.mjs,vercel-output-server.mjs,fake-github.mjs}
|src/lib/studio (owner studio, in progress — access: session.ts (key compare + signed pairing cookie, pure), access.ts (env + cookie I/O), guard.ts (per-route second lock) · repository: config.ts (token/repo/branch), github.ts (snapshot read, raw file, atomic commit, deploy status; pure), store.ts (list, update metadata, delete), taxonomy.ts + validate.ts (pure), summary.js + index-plugin.mjs (build-time post index → `virtual:studio-index`), failure.ts, text.ts · editor: schema.js (TipTap schema shared by browser + Node)):{session.ts,access.ts,guard.ts,config.ts,github.ts,store.ts,taxonomy.ts,validate.ts,summary.js,index-plugin.mjs,failure.ts,text.ts,schema.js}
|public/media/posts (images extracted out of post bodies, served as /media/posts/<slug>/NN.jpg):{<slug>/*}
|stack: Astro 5.18 (output static) + @astrojs/vercel 9 adapter (on-demand rendering for /studio only) + Tailwind4(@tailwindcss/vite) + globe.gl/three/topojson; RTL Arabic; deploy=Vercel
```

## Commands
- `npm run dev` — development server (astro dev)
- `npm run build` — build for production. With the Vercel adapter the result is `.vercel/output/` (static files in `.vercel/output/static`, one function in `functions/_render.func`); `dist/` is only an intermediate.
- `npm run preview` — serve the built `.vercel/output` locally on :4322 the way Vercel routes it (`scripts/lib/vercel-output-server.mjs`; `astro preview` does not work with the Vercel adapter). Set `STUDIO_KEY` to try the studio.
- `npm run build && node scripts/studio-access-check.mjs` — access gate for the owner studio (see Gotchas).
- `npm run build && node scripts/studio-write-check.mjs` — write gate: runs the built bundle against an in-memory GitHub and checks exactly what each studio action commits. Needs no token and touches no real repository.
- Deployed on Vercel (production alias): `https://blog-rahal.vercel.app`

## Conventions
- **Content is Arabic and RTL** — do not translate, reverse, or reorder Arabic text. Preserve direction as-is.
- Fonts: Thmanyah Serif Display is self-hosted as woff2 under `public/fonts/`; Amiri, Reem Kufi, Cormorant Garamond, and JetBrains Mono load from Google Fonts via `BaseLayout.astro`. Post bodies must always render in Thmanyah — the sanitizer strips `font-family` overrides from `content_html` (see `scripts/sanitize-posts.cjs`).
- Use the helpers in `src/utils/posts.ts` for data access — do not read the JSON files directly in pages.
- Styling via Tailwind 4 (utility classes) + `src/styles/global.css`; there is no `tailwind.config` — it's configured through `@tailwindcss/vite` in `astro.config.mjs`.

## Routing & content
- File-based routing. Dynamic pages use `getStaticPaths` (static site / SSG).
- Post URLs: `blog/[slug].astro` builds params from `getPostSlug(post)` (strips `.html`, converts `/` to `-`).
- Posts = 400 JSON files in `src/content/posts/`, read via `import.meta.glob` in `posts.ts`. **No content-collection config** — this is a custom system, do not assume `astro:content`.

## Gotchas
- **`src/data/taxonomy.json` must stay in sync with the posts.** It is auto-generated by `scripts/classify-posts.py` (reads `src/content/posts/*.json` and outputs the classification: continent / countries / type). If you add posts, regenerate it instead of hand-editing.
- The classification key in `taxonomy.posts` is the slug (output of `getPostSlug`) — it must match, otherwise the post won't appear on continent/country pages.
- A post's `type` is either `travel` (has continent/countries) or `other` (has `category`). Destination pages show only `travel`; `destinations/other.astro` shows the rest.
- **New posts arrive automatically and unclassified.** `.github/workflows/sync-blogger.yml` runs `scripts/sync-blogger.mjs` every 3 hours and commits anything newly published on `rahal-k.blogspot.com` straight to `main` (Vercel then deploys). Those posts have no key in `taxonomy.posts`, so they show in `/blog`, the homepage, the album and their own page, but not on continent/country pages until their key is added. `git pull` before working — the bot may have pushed.
- **Post bodies must not carry inline base64 images.** Blogger lets the author paste images straight into a post, which stores them inside `content_html` (one post reached 43MB). `node scripts/extract-inline-images.mjs` moves them to `public/media/posts/<slug>/` and is safe to re-run; run it if a synced post arrives with `data:image/` in it.
- **One slug = one file.** Astro silently builds only the last file (alphabetically) when two posts share a slug.
- **Editor schema changes must pass the round-trip gate:** `node scripts/studio-roundtrip.mjs` pushes every post through `src/lib/studio/schema.js` and fails if any text, image, link, embed or table is lost. Don't swap the custom `fontSize`/`textColor`/`highlight` marks for TipTap's `TextStyle` extension — its nested-span merging grows exponentially on Blogger HTML.
- **Owner studio (`/studio`) — private page for the blog owner, no login by the owner's decision.** Access = a secret link `/studio/enter/<STUDIO_KEY>` that sets a signed pairing cookie and redirects to `/studio`; everyone else gets the normal 404 page. `STUDIO_KEY` is a Vercel env var (Production only; ≥32 URL-safe chars; locally in the git-ignored `.env.local`). No key, a Preview deployment, or an untrusted host ⇒ the studio answers 404 to everything. Changing the key revokes the link and every paired device.
- **Every route under `/studio` and `/api/studio` must** `export const prerender = false`, start with `requireStudio(...)` from `src/lib/studio/guard.ts`, and never return a 404 with an empty body (Astro would fetch `/404.html` over the network to fill it). **After touching `src/middleware.ts`, `src/lib/studio/{session,access,guard}.ts`, any studio route, or the adapter config, run `npm run build && node scripts/studio-access-check.mjs`** — it runs the real production bundle and fails if the studio opens without a valid pairing.
- **The studio has no database — it writes to this repository through the GitHub API** (`STUDIO_GITHUB_TOKEN`: fine-grained, this repo only, Contents read/write + Commit statuses read). Every write is one atomic commit conditioned on the branch head it read (`expectedHeadOid`); if the branch moved (the sync bot, another device) it re-reads and re-applies. Keep that pattern: read a snapshot → change what was read → `createCommit` → retry on `StaleHeadError`. After touching `src/lib/studio/{github,store,taxonomy,validate,config}.ts` or a studio page, run the write gate.
- **Which branch the studio writes to:** `main` only on Vercel Production. Anywhere else the default is `studio-sandbox` (override with `STUDIO_BRANCH`), so a local run never reaches the live site by accident. `vercel.json` turns off Vercel deployments for `studio-sandbox`.
- **`src/data/removed-posts.json` is the studio's deleted-posts list.** A delete removes the post file, removes its `taxonomy.posts` key and appends a record there, in one commit. `scripts/sync-blogger.mjs` treats those slugs as existing — without the record a deleted Blogger post comes back within 3 hours. Don't remove records by hand unless the post should be re-imported.
- **The studio edits `taxonomy.json` in place** (one key, appended at the end when new, everything else byte-identical) and applies only the form fields the user actually changed. Regenerating the file with the classifier scripts would discard those edits.
- **Studio list = build-time index + live diff.** `virtual:studio-index` (title/date/… and the git blob id of every post, built by `src/lib/studio/index-plugin.mjs`) ships inside the function; at request time the studio compares blob ids with the branch tree and fetches only files that changed since the build. Don't import `getAllPosts()` from studio code — it would bundle every post body into the function.
- **`security.allowedDomains` in `astro.config.mjs` must list every host the site is served on.** Without a match Astro replaces the host with `localhost`, and the studio refuses the request (by design). Add a custom domain there when one is connected.
- **Studio responses use `Referrer-Policy: same-origin`, not `no-referrer`.** With `no-referrer` browsers send `Origin: null` on same-site POSTs and every studio form/button fails the Origin check with 403.
- **`NotFoundPage.astro` must render byte-identically from `404.astro` (static) and `studio/not-found.astro` (server)** — no props, nothing read from the request. A difference reveals that the studio exists.
- **Public pages must stay prerendered.** The middleware answers 404 to any non-studio on-demand request (that closes Astro's `/_image` and `/_server-islands` endpoints, unused here). A new server-rendered feature outside `/studio` needs that rule revisited.
- Backup files exist in the repo (`index.astro.backup-quotes-organized` and others) — ignore them, they are not live routes.
