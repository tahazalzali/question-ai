import { createHttpClient, withTimeout } from '../../utils/http';
import { config } from '../../config/env';
import { logger } from '../../utils/logger';

export interface BraveSearchResult {
  url?: string;
  title?: string;
  snippet?: string;
}

function mapWebResults(items: any[]): BraveSearchResult[] {
  if (!Array.isArray(items)) return [];
  return items.map((r: any) => ({
    title: r?.title || '',
    url: r?.url || '',
    snippet: r?.description || '',
  }));
}

export async function braveWebSearch(
  query: string,
  opts: { maxResults?: number } = {},
): Promise<BraveSearchResult[]> {
  if (!config.brave.apiKey) {
    logger.warn('Brave API key not set; skipping braveWebSearch');
    return [];
  }

  const client = createHttpClient(config.brave.baseUrl, 10000);

  try {
    const resp = await withTimeout(
      client.get('/res/v1/web/search', {
        params: {
          q: query,
          count: Math.min(Math.max(opts.maxResults ?? 5, 1), 5),
        },
        headers: {
          'X-Subscription-Token': config.brave.apiKey,
          Accept: 'application/json',
        },
      }),
      10000,
    );

    const webResults = resp.data?.web?.results || [];
    const results = mapWebResults(webResults);

    logger.info(`Brave web results (${results.length}) for query`, { query });
    return results;
  } catch (err: any) {
    logger.error('Brave web search failed', err?.response?.data || err?.message || err);
    return [];
  }
}