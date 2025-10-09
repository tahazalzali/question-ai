import { perplexityWebSearch } from './providers/perplexity';
import { braveWebSearch } from './providers/brave';
import { filterAndNormalize } from './aiFilter';
import { Person, IPerson } from '../models/Person';
import { logger } from '../utils/logger';
import { getCache, setCache } from './cache';

function extractNameFromTitle(title?: string): string | null {
  const t = (title || '').trim();
  if (!t) return null;
  const first = t.split('|')[0].split(' - ')[0].trim();
  if (/linkedin|profile/i.test(first)) return null;
  return first || null;
}

function extractNameFromLinkedInUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/').filter(Boolean);
    const idx = parts.findIndex(p => p.toLowerCase() === 'in');
    const handle = idx >= 0 ? parts[idx + 1] : parts[0];
    if (!handle) return null;
    const raw = decodeURIComponent(handle).replace(/[-_]+/g, ' ').trim();
    if (!raw) return null;
    // Capitalize words
    return raw
      .split(' ')
      .map(w => (w ? w[0].toUpperCase() + w.slice(1) : w))
      .join(' ');
  } catch {
    return null;
  }
}

const normalize = (q: string) => (q || '').trim().toLowerCase();

/**
 * Cached version of searchAndExtract to avoid repeating identical searches.
 * - Caches non-empty results for 10m
 * - Caches empty results for 2m (to prevent hammering)
 */
export async function searchAndExtractCached(query: string): Promise<IPerson[]> {
  const key = `search:${normalize(query)}`;
  const cached = getCache<IPerson[]>(key);
  if (cached.hit) {
    logger.info('Search cache hit', { query });
    return cached.value || [];
  }

  const persons = await searchAndExtract(query);
  // Cache short when empty to avoid repeated retries
  const ttl = persons.length > 0 ? 10 * 60 * 1000 : 2 * 60 * 1000;
  setCache(key, persons, ttl);
  logger.info('Search cache set', { query, count: persons.length, ttlMs: ttl });
  return persons;
}

export async function searchAndExtract(query: string): Promise<IPerson[]> {
  try {
    logger.info('searchAndExtract start', { query });

    const [perplexityResults, braveResults] = await Promise.all([
      perplexityWebSearch(query, { maxResults: 4 }),
      braveWebSearch(query, { maxResults: 4 }),
    ]);

    logger.info('Provider results', {
      query,
      perplexityCount: perplexityResults.length,
      braveCount: braveResults.length,
    });

    const mergedResults = [
      ...perplexityResults.map(r => ({ ...r, provider: 'perplexity' as const })),
      ...braveResults.map(r => ({ ...r, provider: 'brave' as const })),
    ];

    logger.info('Merged web results', { query, mergedCount: mergedResults.length });

    let candidates = await filterAndNormalize(mergedResults);

    logger.info('AI candidates after normalize', { query, candidateCount: candidates.length });

    if (candidates.length === 0) {
      const byUrl = new Map<string, any>();
      for (const r of mergedResults) {
        const url = (r as any).url || '';
        if (!url || !/linkedin\.com\/in\//i.test(url)) continue;
        const cleanUrl = url.split('?')[0];
        if (byUrl.has(cleanUrl)) continue;

        const fullName =
          extractNameFromTitle((r as any).title) ||
          extractNameFromLinkedInUrl(cleanUrl);

        if (!fullName) continue;

        byUrl.set(cleanUrl, {
          fullName,
          firstName: null,
          middleName: null,
          lastName: null,
          professions: [], // unknown
          employers: [],
          education: [],
          emails: [],
          phones: [],
          social: { linkedin: cleanUrl },
          age: null,
          gender: null,
          locations: [],
          relatedPeople: [],
          sources: [{ provider: (r as any).provider, url: cleanUrl }],
          confidence: 0.2,
        });
      }

      candidates = Array.from(byUrl.values());
      logger.warn('AI returned no candidates; using LinkedIn fallback', {
        query,
        fallbackCount: candidates.length,
      });
    }

    // Upsert to database
    const upsertedPersons: IPerson[] = [];
    for (const candidate of candidates) {
      const person = await Person.findOneAndUpdate(
        {
          fullName: candidate.fullName,
          'social.linkedin': candidate.social.linkedin,
        },
        candidate,
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
      if (person) upsertedPersons.push(person);
    }

    logger.info('searchAndExtract complete', {
      query,
      upsertedCount: upsertedPersons.length,
    });

    return upsertedPersons;
  } catch (error) {
    logger.error('Search and extract failed', error);
    throw error;
  }
}