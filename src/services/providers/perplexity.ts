import { createHttpClient, withTimeout } from '../../utils/http';
import { config } from '../../config/env';
import { logger } from '../../utils/logger';

export interface PerplexitySearchResult {
  url?: string;
  title?: string;
  snippet?: string;
}

function truncate(s: string, n = 240): string {
  if (!s) return '';
  const flat = s.replace(/\s+/g, ' ').trim();
  return flat.length > n ? `${flat.slice(0, n)}…` : flat;
}

function logPerplexityResults(context: string, results: PerplexitySearchResult[]) {
  if (!Array.isArray(results)) return;
  const lines = results.map((r, i) => {
    const title = r.title || '(no title)';
    const url = r.url || '(no url)';
    const snip = truncate(r.snippet || '');
    return `  ${i + 1}. ${title}\n     URL: ${url}\n     Snippet: ${snip}`;
  });
  logger.info(
    `Perplexity ${context} results (${results.length})` +
      (lines.length ? `:\n${lines.join('\n')}` : ''),
  );
}

function mergeResults(
  primary: PerplexitySearchResult[],
  fallback: PerplexitySearchResult[],
): PerplexitySearchResult[] {
  const out: PerplexitySearchResult[] = [];
  const seen = new Set<string>();

  const add = (item: PerplexitySearchResult) => {
    const urlKey = (item.url || '').trim().toLowerCase();
    const titleKey = (item.title || '').trim().toLowerCase();
    const key = urlKey || titleKey;
    if (key && seen.has(key)) return;
    if (key) seen.add(key);
    out.push(item);
  };

  primary.forEach(add);
  fallback.forEach(add);
  return out;
}

const mapPerplexityResult = (item: any): PerplexitySearchResult => ({
  title: item?.title || '',
  url: item?.url || '',
  snippet: item?.snippet || '',
});


function hasLinkedInHit(results: PerplexitySearchResult[]): boolean {
  return results.some(r => (r.url || '').toLowerCase().includes('linkedin.com/in/'));
}

async function requestPerplexitySearch(
  client: ReturnType<typeof createHttpClient>,
  query: string,
  maxResults: number,
): Promise<PerplexitySearchResult[]> {
  const response = await withTimeout(
    client.post(
      '/search',
      {
        query,
        max_results: maxResults,
        max_tokens_per_page: 1024,
      },
      {
        headers: {
          Authorization: `Bearer ${config.perplexity.apiKey}`,
        },
      },
    ),
    10000,
  );

  const raw = Array.isArray(response.data?.results) ? response.data.results : [];
  return raw.map(mapPerplexityResult);
}

export async function perplexityWebSearch(
  query: string,
  opts: { maxResults?: number } = {},
): Promise<PerplexitySearchResult[]> {
  if (!config.perplexity.apiKey) {
    logger.warn('Perplexity API key not set; skipping perplexityWebSearch');
    return [];
  }

  const client = createHttpClient(config.perplexity.baseUrl);
  const maxResults = opts.maxResults || 5;

  try {
    const primaryResults = await requestPerplexitySearch(client, query, maxResults);

    if (!primaryResults.length) {
      logPerplexityResults('web', []);
      return [];
    }

    let finalResults = primaryResults;

    if (!hasLinkedInHit(primaryResults)) {
      logger.info('Perplexity fallback triggered (no LinkedIn hits)', { query });

      try {
        const fallbackQuery = `${query} site:linkedin.com/in`;
        const fallbackResults = await requestPerplexitySearch(client, fallbackQuery, maxResults);

        if (fallbackResults.length > 0) {
          logPerplexityResults('fallback', fallbackResults);
          finalResults = mergeResults(primaryResults, fallbackResults);
          logger.info('Perplexity fallback merged results', {
            query,
            primaryCount: primaryResults.length,
            fallbackCount: fallbackResults.length,
            mergedCount: finalResults.length,
          });
        }
      } catch (fallbackError: any) {
        logger.warn('Perplexity fallback request failed', {
          query,
          message: fallbackError?.message,
        });
      }
    }

    logPerplexityResults('web', finalResults);
    return finalResults;
  } catch (error) {
    logger.error('Perplexity web search failed', error);
    return [];
  }
}
