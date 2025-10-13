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

const BULK_DUMP_URL_PATTERNS = [
  /\.csv$/i,
  /\.tsv$/i,
  /\.xls$/i,
  /\.xlsx$/i,
  /\.pdf$/i,
  /\.docx?$/i,
];

function countUrls(text: string): number {
  return (text.match(/https?:\/\//gi) || []).length;
}

function isLowSignalResult(result: PerplexitySearchResult): boolean {
  const url = (result.url || '').toLowerCase();
  if (BULK_DUMP_URL_PATTERNS.some(re => re.test(url))) return true;

  const snippet = (result.snippet || '').toLowerCase();
  const urlMentions = countUrls(snippet);
  if (urlMentions >= 3) return true;

  if (snippet.includes('profileurl') && urlMentions >= 2) return true;

  if (snippet.length > 1200 && urlMentions >= 2) return true;

  if (snippet.includes('linkedin.com/in') && urlMentions >= 3) return true;

  return false;
}

function sanitizePerplexityResults(results: PerplexitySearchResult[]): PerplexitySearchResult[] {
  const filtered = results.filter(r => !isLowSignalResult(r));
  if (filtered.length !== results.length) {
    logger.info('Filtered low-signal Perplexity results', {
      dropped: results.length - filtered.length,
      kept: filtered.length,
    });
  }
  return filtered;
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

    const mapped: PerplexitySearchResult[] = response.data.results.map((item: any) => ({
      title: item.title || '',
      url: item.url || '',
      snippet: item.snippet || '',
    }));

    const results = sanitizePerplexityResults(mapped);

    logger.info('Perplexity search successful', {
      query,
      resultCount: results.length,
      rawCount: mapped.length,
      attempt: 1,
    });

    return results;
  } catch (error) {
    logger.error('Perplexity web search failed', error);
    return [];
  }
}

