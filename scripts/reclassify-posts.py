#!/usr/bin/env python3
"""
Reclassify posts in src/data/taxonomy.json:
- Migrate schema: country: string|null → countries: string[]
- Auto-detect countries from titles for unindexed posts (46)
- Detect additional countries for multi-country posts
"""
import json
import re
import sys
import glob
from pathlib import Path

ROOT = Path(__file__).parent.parent
TAXONOMY_PATH = ROOT / 'src' / 'data' / 'taxonomy.json'
POSTS_DIR = ROOT / 'src' / 'content' / 'posts'


# Strip author/blog signatures before scanning — these are not location references
SIGNATURE_PATTERNS = [
    re.compile(r'#?رح?ا?ل[\s_]*الخبر', re.UNICODE),
    re.compile(r'وائل\s*(بن\s*)?(عبدالعزيز\s*)?الدغفق', re.UNICODE),
    re.compile(r'د\.\s*وائل', re.UNICODE),
    re.compile(r'رح?الة\s*الجزيرة\s*العربية', re.UNICODE),
    re.compile(r'Rahal\s*Alkhobar', re.IGNORECASE),
]


def strip_signature(s: str) -> str:
    """Remove author/blog signatures so they don't trigger location matches.
    Operates on diacritic-stripped text for robustness."""
    # Pre-strip diacritics so shadda etc. don't break the patterns
    stripped = re.sub(r'[ً-ْٰ]', '', s)
    for pat in SIGNATURE_PATTERNS:
        stripped = pat.sub(' ', stripped)
    return stripped


def normalize(s: str) -> str:
    """Normalize Arabic for matching: unify hamza/alef variants, ya, etc."""
    s = strip_signature(s)
    s = s.lower()
    s = re.sub(r'[أإآا]', 'ا', s)
    s = re.sub(r'ى', 'ي', s)
    s = re.sub(r'ؤ', 'و', s)
    s = re.sub(r'ئ', 'ي', s)
    s = re.sub(r'ة', 'ه', s)
    return s


# Known countries not yet in taxonomy.countries but appear in posts.
# (name, continent, slug)
EXTRA_COUNTRIES = [
    ('جنوب أفريقيا', 'أفريقيا', 'south-africa'),
    ('نيوزلندا', 'أوقيانوسيا', 'new-zealand'),
    ('أستراليا', 'أوقيانوسيا', 'australia'),
    ('السودان', 'أفريقيا', 'sudan'),
    ('إثيوبيا', 'أفريقيا', 'ethiopia'),
    ('ناميبيا', 'أفريقيا', 'namibia'),
    ('تنزانيا', 'أفريقيا', 'tanzania'),
    ('أوغندا', 'أفريقيا', 'uganda'),
    ('الصومال', 'أفريقيا', 'somalia'),
    ('الكاميرون', 'أفريقيا', 'cameroon'),
    ('نيجيريا', 'أفريقيا', 'nigeria'),
    ('السنغال', 'أفريقيا', 'senegal'),
    ('موريتانيا', 'أفريقيا', 'mauritania'),
    ('تشاد', 'أفريقيا', 'chad'),
    ('النيجر', 'أفريقيا', 'niger'),
    ('ليبيا', 'أفريقيا', 'libya'),
    ('سوريا', 'الشرق الأوسط', 'syria'),
    ('لبنان', 'الشرق الأوسط', 'lebanon'),
    ('إيران', 'الشرق الأوسط', 'iran'),
    ('الإمارات', 'الشرق الأوسط', 'uae'),
    ('أذربيجان', 'آسيا', 'azerbaijan'),
    ('كازاخستان', 'آسيا', 'kazakhstan'),
    ('طاجكستان', 'آسيا', 'tajikistan'),
    ('فيتنام', 'آسيا', 'vietnam'),
    ('كمبوديا', 'آسيا', 'cambodia'),
    ('سنغافورة', 'آسيا', 'singapore'),
    ('فرنسا', 'أوروبا', 'france'),
    ('هولندا', 'أوروبا', 'netherlands'),
    ('سويسرا', 'أوروبا', 'switzerland'),
    ('بلجيكا', 'أوروبا', 'belgium'),
    ('الدنمارك', 'أوروبا', 'denmark'),
    ('السويد', 'أوروبا', 'sweden'),
    ('فنلندا', 'أوروبا', 'finland'),
    ('رومانيا', 'أوروبا', 'romania'),
    ('صربيا', 'أوروبا', 'serbia'),
    ('كرواتيا', 'أوروبا', 'croatia'),
    ('سلوفاكيا', 'أوروبا', 'slovakia'),
    ('المملكة المتحدة', 'أوروبا', 'uk'),
    ('بريطانيا', 'أوروبا', 'uk'),
    ('كندا', 'أمريكا الشمالية', 'canada'),
    ('فنزويلا', 'أمريكا الجنوبية', 'venezuela'),
    ('باراغواي', 'أمريكا الجنوبية', 'paraguay'),
    ('أوروغواي', 'أمريكا الجنوبية', 'uruguay'),
]

# Aliases: alternative name/city → canonical country (in taxonomy)
ALIASES = {
    # Country variants
    'سيلان': 'سريلانكا',
    'سرنديب': 'سريلانكا',
    'افريقيا الجنوبية': 'جنوب أفريقيا',
    'نيوزيلندا': 'نيوزلندا',
    'الامارات': 'الإمارات',
    'امريكا': 'أمريكا',
    'الولايات المتحدة': 'أمريكا',
    'الجبل الاسود': 'البوسنة',  # closest neighbor; could be its own country
    'مونتنيغرو': 'البوسنة',
    # Saudi Arabia — cities/regions
    'خيبر': 'السعودية',
    'حرة خيبر': 'السعودية',
    'وادي خيبر': 'السعودية',
    'المدينة المنورة': 'السعودية',
    'الحجاز': 'السعودية',
    'دارين': 'السعودية',
    'الزلفي': 'السعودية',
    'الاحساء': 'السعودية',
    'الخبر': 'السعودية',
    'الرياض': 'السعودية',
    'جدة': 'السعودية',
    'العلا': 'السعودية',
    'الطائف': 'السعودية',
    'حائل': 'السعودية',
    'المنطقة الشرقية': 'السعودية',
    'الجزيرة العربية': 'السعودية',
    'الجبيل': 'السعودية',
    'الدمام': 'السعودية',
    'تبوك': 'السعودية',
    'القصيم': 'السعودية',
    # Cities → countries
    'شنغهاي': 'الصين',
    'بكين': 'الصين',
    'كاشغر': 'الصين',
    'هونغ كونغ': 'الصين',
    'سالزبورغ': 'النمسا',
    'فيينا': 'النمسا',
    'الامازون': 'البرازيل',
    'ساوباولو': 'البرازيل',
    'ريو دي جانيرو': 'البرازيل',
    'ريودي جانيرو': 'البرازيل',
    'كانكون': 'المكسيك',
    'بنغلور': 'الهند',
    'دلهي': 'الهند',
    'مومباي': 'الهند',
    'بومباي': 'الهند',
    'كشمير': 'الهند',
    'بوسطن': 'أمريكا',
    'نيويورك': 'أمريكا',
    'لوس انجلوس': 'أمريكا',
    'اسطنبول': 'تركيا',
    'انقرة': 'تركيا',
    'باريس': 'فرنسا',
    'لندن': 'بريطانيا',
    'مدريد': 'إسبانيا',
    'برشلونة': 'إسبانيا',
    'روما': 'إيطاليا',
    'البندقية': 'إيطاليا',
    'فينيسيا': 'إيطاليا',
    'لوكا': 'إيطاليا',
    'برلين': 'ألمانيا',
    'كييف': 'أوكرانيا',
    'بنغلاديش': None,
}


def load_taxonomy():
    with open(TAXONOMY_PATH) as f:
        return json.load(f)


def load_all_posts():
    posts = []
    for f in sorted(POSTS_DIR.glob('*.json')):
        with open(f) as fp:
            d = json.load(fp)
        slug = d['slug'].replace('.html', '').replace('/', '-')
        posts.append({
            'slug': slug,
            'title': d['title'],
            'content_preview': (d.get('content_text') or '')[:600],
            'date': d['date'][:10],
        })
    return posts


def build_detector(taxonomy: dict):
    """Return list of (normalized_name, canonical_name, continent) sorted by length desc."""
    detector = []

    # Known countries from taxonomy
    for name, meta in taxonomy['countries'].items():
        detector.append((normalize(name), name, meta['continent']))

    # Extra countries
    for name, continent, slug in EXTRA_COUNTRIES:
        detector.append((normalize(name), name, continent))

    # Aliases (alias points to canonical)
    name_to_continent = {n: c for n, c, _ in EXTRA_COUNTRIES}
    for name, meta in taxonomy['countries'].items():
        name_to_continent[name] = meta['continent']

    for alias, canonical in ALIASES.items():
        if canonical and canonical in name_to_continent:
            detector.append((normalize(alias), canonical, name_to_continent[canonical]))

    # Sort by length DESC so longer matches (e.g., "جنوب أفريقيا") win over "أفريقيا"
    detector.sort(key=lambda x: -len(x[0]))
    return detector


def detect_countries_in_text(text: str, detector: list) -> list:
    """Return list of (country, continent) tuples found in text, preserving order, no duplicates."""
    norm_text = normalize(text)
    found = []
    seen = set()
    # Track positions consumed to avoid substring overlaps (longer matches first)
    consumed = [False] * len(norm_text)

    for norm_name, canonical, continent in detector:
        idx = norm_text.find(norm_name)
        while idx >= 0:
            # Check if this region is already consumed
            if not any(consumed[idx:idx + len(norm_name)]):
                # Word-boundary check at START only (Arabic morphology allows suffixes like ية/ات)
                prev_ok = idx == 0 or not norm_text[idx - 1].isalpha()
                if prev_ok and canonical not in seen:
                    found.append((canonical, continent))
                    seen.add(canonical)
                    for i in range(idx, idx + len(norm_name)):
                        consumed[i] = True
                    break
            idx = norm_text.find(norm_name, idx + 1)
    return found


def main():
    print("Loading taxonomy and posts...")
    taxonomy = load_taxonomy()
    posts = load_all_posts()
    detector = build_detector(taxonomy)
    indexed = set(taxonomy['posts'].keys())

    # Slug map for new countries (for adding to taxonomy.countries)
    extra_slug_map = {name: slug for name, _, slug in EXTRA_COUNTRIES}

    report_recovered = []
    report_multi = []
    report_unrecovered = []
    new_countries_used = set()

    new_posts = {}

    for post in posts:
        slug = post['slug']
        existing = taxonomy['posts'].get(slug)
        title = post['title']

        if existing and existing.get('type') == 'other':
            # Keep as-is (just migrate schema)
            new_posts[slug] = {
                'continent': None,
                'countries': [],
                'type': 'other',
                'category': existing.get('category', 'عام'),
            }
            continue

        # Detect countries in title (and content_preview for unindexed posts)
        is_unindexed = slug not in indexed
        search_text = title
        if is_unindexed:
            search_text = title + ' ' + post['content_preview']

        detected = detect_countries_in_text(search_text, detector)

        if existing and existing.get('type') == 'travel':
            # Already classified: keep primary country, add new ones from title only
            primary_country = existing.get('country')
            primary_continent = existing.get('continent')
            countries = []
            if primary_country:
                countries.append(primary_country)
            # Detect additional from title only (avoid false positives)
            title_detected = detect_countries_in_text(title, detector)
            for c, _ in title_detected:
                if c not in countries:
                    countries.append(c)
            if len(countries) > 1:
                report_multi.append((slug, title, countries))
            new_posts[slug] = {
                'continent': primary_continent,
                'countries': countries,
                'type': 'travel',
            }
            # Track new countries
            for c in countries:
                if c not in taxonomy['countries'] and c in extra_slug_map:
                    new_countries_used.add(c)
        else:
            # Unindexed — try to recover
            if detected:
                countries = [c for c, _ in detected]
                continent = detected[0][1]
                new_posts[slug] = {
                    'continent': continent,
                    'countries': countries,
                    'type': 'travel',
                }
                report_recovered.append((slug, title, countries))
                for c in countries:
                    if c not in taxonomy['countries'] and c in extra_slug_map:
                        new_countries_used.add(c)
            else:
                # Couldn't classify — default to 'other:عام'
                new_posts[slug] = {
                    'continent': None,
                    'countries': [],
                    'type': 'other',
                    'category': 'عام',
                }
                report_unrecovered.append((slug, title))

    # Add new countries to taxonomy.countries
    countries_added = []
    for name, continent, slug in EXTRA_COUNTRIES:
        if name in new_countries_used and name not in taxonomy['countries']:
            taxonomy['countries'][name] = {'slug': slug, 'continent': continent}
            countries_added.append((name, continent))

    # Update taxonomy
    taxonomy['posts'] = new_posts

    # ===== REPORT =====
    print(f"\n{'='*70}")
    print(f"📋 RECLASSIFICATION REPORT")
    print(f"{'='*70}\n")

    print(f"✓ Recovered (unindexed → travel): {len(report_recovered)} posts")
    for slug, title, countries in report_recovered[:50]:
        print(f"   [{slug[:40]:40}] {title[:60]}")
        print(f"       → {' + '.join(countries)}")
    if len(report_recovered) > 50:
        print(f"   ... +{len(report_recovered)-50} more")

    print(f"\n✓ Multi-country detected: {len(report_multi)} posts")
    for slug, title, countries in report_multi[:30]:
        print(f"   [{slug[:40]:40}] {title[:60]}")
        print(f"       → {' + '.join(countries)}")
    if len(report_multi) > 30:
        print(f"   ... +{len(report_multi)-30} more")

    print(f"\n⚠ Unrecovered (defaulted to 'other:عام'): {len(report_unrecovered)} posts")
    for slug, title in report_unrecovered[:20]:
        print(f"   [{slug[:40]:40}] {title[:60]}")
    if len(report_unrecovered) > 20:
        print(f"   ... +{len(report_unrecovered)-20} more")

    print(f"\n✓ New countries added to taxonomy: {len(countries_added)}")
    for name, cont in countries_added:
        print(f"   + {name} ({cont})")

    # Summary
    travel = sum(1 for p in new_posts.values() if p['type'] == 'travel')
    other = sum(1 for p in new_posts.values() if p['type'] == 'other')
    print(f"\n📊 Final totals: travel={travel}, other={other}, total={travel+other}")

    if '--write' in sys.argv:
        with open(TAXONOMY_PATH, 'w', encoding='utf-8') as f:
            json.dump(taxonomy, f, ensure_ascii=False, indent=2)
        print(f"\n✅ Wrote {TAXONOMY_PATH}")
    else:
        print(f"\n(Dry run — pass --write to save)")


if __name__ == '__main__':
    main()
