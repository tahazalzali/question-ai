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

export async function perplexityWebSearch(
  query: string,
  opts: { maxResults?: number } = {},
): Promise<PerplexitySearchResult[]> {
  if (!config.perplexity.apiKey) {
    logger.warn('Perplexity API key not set; skipping perplexityWebSearch');
    return [];
  }

  const client = createHttpClient(config.perplexity.baseUrl);

  try {
    const response = await withTimeout(
      client.post(
        '/search',
        {
          query,
          max_results: opts.maxResults || 5,
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

    if (!response.data.results) {
      logPerplexityResults('web', []);
      return [];
    }

    const results: PerplexitySearchResult[] = response.data.results.map((item: any) => ({
      title: item.title || '',
      url: item.url || '',
      snippet: item.snippet || '',
    }));

    logPerplexityResults('web', results);
    return results;
  } catch (error) {
    logger.error('Perplexity web search failed', error);
    return [];
  }
}
