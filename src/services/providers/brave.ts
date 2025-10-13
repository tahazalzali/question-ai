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
  return items
    .filter((r: any) => {
      const url = (r?.url || '').toLowerCase();
      return !url.includes('linkedin.com/pub/dir/');
    })
    .map((r: any) => ({
      title: r?.title || '',
      url: r?.url || '',
      snippet: r?.description || '',
    }));
}

let resultHandler: ((context: string, results: BraveSearchResult[]) => void) | null = null;

export function setBraveResultHandler(handler: typeof resultHandler) {
  resultHandler = handler;
}

function logBraveResults(context: string, results: BraveSearchResult[]) {
  if (resultHandler) resultHandler(context, results);
  if (!Array.isArray(results)) return;
  results.forEach((r, i) => {
    const title = r.title || '(no title)';
    const url = r.url || '(no url)';
    const snippet = r.snippet || '';
    console.log(`Brave ${context} result ${i + 1}: ${title} | ${url} | ${snippet}`);
  });
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
          count: opts.maxResults ?? 5,
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

    logBraveResults('web', results);
    logger.info(`Brave web results (${results.length}) for query`, { query });
    return results;
  } catch (err: any) {
    logger.error('Brave web search failed', err?.response?.data || err?.message || err);
    return [];
  }
}