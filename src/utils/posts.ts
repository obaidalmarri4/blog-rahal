import taxonomyData from '../data/taxonomy.json';

export interface Post {
  title: string;
  date: string;
  url: string;
  slug: string;
  content_html: string;
  content_text: string;
  labels: string[];
  images: {
    original_url: string;
    thumbnail_url: string;
    alt: string;
    local_path: string;
  }[];
  image_count: number;
}

interface TaxonomyEntry {
  continent: string | null;
  country: string | null;
  type: string;
  category?: string;
}

interface ContinentMeta {
  emoji: string;
  slug: string;
}

interface CountryMeta {
  slug: string;
  continent: string;
}

interface Taxonomy {
  posts: Record<string, TaxonomyEntry>;
  continents: Record<string, ContinentMeta>;
  countries: Record<string, CountryMeta>;
}

const taxonomy = taxonomyData as Taxonomy;

export async function getAllPosts(): Promise<Post[]> {
  const postFiles = import.meta.glob('/src/content/posts/*.json', { eager: true });
  const posts: Post[] = Object.values(postFiles).map((mod: any) => mod.default || mod);
  posts.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  return posts;
}

export function getExcerpt(text: string, maxLength: number = 150): string {
  if (!text) return '';
  const clean = text.replace(/\n+/g, ' ').trim();
  if (clean.length <= maxLength) return clean;
  return clean.substring(0, maxLength) + '...';
}

export function getPostCoverImage(post: Post): string | undefined {
  if (post.images && post.images.length > 0) {
    const img = post.images[0];
    if (img.original_url) {
      return img.original_url;
    }
  }
  return undefined;
}

export function getPostSlug(post: Post): string {
  return post.slug.replace(/\.html$/, '').replace(/\//g, '-');
}

// --- دوال التصنيف الجديدة ---

export function getPostTaxonomy(post: Post): TaxonomyEntry | null {
  const slug = getPostSlug(post);
  return taxonomy.posts[slug] || null;
}

export function getContinents(): { name: string; emoji: string; slug: string; postCount: number; countryCount: number }[] {
  const continentStats: Record<string, { posts: number; countries: Set<string> }> = {};

  for (const [, entry] of Object.entries(taxonomy.posts)) {
    if (entry.type === 'travel' && entry.continent) {
      if (!continentStats[entry.continent]) {
        continentStats[entry.continent] = { posts: 0, countries: new Set() };
      }
      continentStats[entry.continent].posts++;
      if (entry.country) {
        continentStats[entry.continent].countries.add(entry.country);
      }
    }
  }

  return Object.entries(taxonomy.continents)
    .filter(([name]) => continentStats[name])
    .map(([name, meta]) => ({
      name,
      emoji: meta.emoji,
      slug: meta.slug,
      postCount: continentStats[name]?.posts || 0,
      countryCount: continentStats[name]?.countries.size || 0,
    }))
    .sort((a, b) => b.postCount - a.postCount);
}

export function getContinentBySlug(slug: string): { name: string; emoji: string; slug: string } | null {
  for (const [name, meta] of Object.entries(taxonomy.continents)) {
    if (meta.slug === slug) return { name, ...meta };
  }
  return null;
}

export function getCountriesByContinent(continentName: string): { name: string; slug: string; postCount: number }[] {
  const countryStats: Record<string, number> = {};

  for (const [, entry] of Object.entries(taxonomy.posts)) {
    if (entry.type === 'travel' && entry.continent === continentName && entry.country) {
      countryStats[entry.country] = (countryStats[entry.country] || 0) + 1;
    }
  }

  return Object.entries(countryStats)
    .map(([name, count]) => ({
      name,
      slug: taxonomy.countries[name]?.slug || name.toLowerCase().replace(/ /g, '-'),
      postCount: count,
    }))
    .sort((a, b) => b.postCount - a.postCount);
}

export function getCountryBySlug(slug: string): { name: string; slug: string; continent: string } | null {
  for (const [name, meta] of Object.entries(taxonomy.countries)) {
    if (meta.slug === slug) return { name, ...meta };
  }
  return null;
}

export async function getPostsByContinent(continentName: string): Promise<Post[]> {
  const allPosts = await getAllPosts();
  return allPosts.filter(post => {
    const tx = getPostTaxonomy(post);
    return tx?.type === 'travel' && tx.continent === continentName;
  });
}

export async function getPostsByCountry(countryName: string): Promise<Post[]> {
  const allPosts = await getAllPosts();
  return allPosts.filter(post => {
    const tx = getPostTaxonomy(post);
    return tx?.type === 'travel' && tx.country === countryName;
  });
}

export async function getOtherPosts(): Promise<{ category: string; posts: Post[] }[]> {
  const allPosts = await getAllPosts();
  const categoryMap: Record<string, Post[]> = {};

  for (const post of allPosts) {
    const tx = getPostTaxonomy(post);
    if (tx?.type === 'other') {
      const cat = tx.category || 'عام';
      if (!categoryMap[cat]) categoryMap[cat] = [];
      categoryMap[cat].push(post);
    }
  }

  return Object.entries(categoryMap)
    .map(([category, posts]) => ({ category, posts }))
    .sort((a, b) => b.posts.length - a.posts.length);
}

export function getAllContinentSlugs(): string[] {
  const slugs = new Set<string>();
  for (const [, entry] of Object.entries(taxonomy.posts)) {
    if (entry.type === 'travel' && entry.continent) {
      const meta = taxonomy.continents[entry.continent];
      if (meta) slugs.add(meta.slug);
    }
  }
  return [...slugs];
}

export function getAllCountrySlugsForContinent(continentSlug: string): string[] {
  const continent = getContinentBySlug(continentSlug);
  if (!continent) return [];

  const slugs = new Set<string>();
  for (const [, entry] of Object.entries(taxonomy.posts)) {
    if (entry.type === 'travel' && entry.continent === continent.name && entry.country) {
      const meta = taxonomy.countries[entry.country];
      if (meta) slugs.add(meta.slug);
    }
  }
  return [...slugs];
}
