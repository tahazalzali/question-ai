import { logger } from '../../utils/logger';
import { ResultCompactor } from './compactor';
import { JsonExtractor } from './jsonExtractor';
import { PerplexityClient } from './aiClient';
import { responseSchema, type CandidatesResponse } from './schemas';
import { CandidateNormalizers } from './normalizers';

export class FilterService {
  private compactor = new ResultCompactor();
  private json = new JsonExtractor();
  private ai = new PerplexityClient();
  private norms = new CandidateNormalizers();

  private buildVariants(rawResults: any[]) {
    return [
      this.compactor.compactResults(rawResults, 12),
      this.compactor.compactResults(rawResults, 8),
      this.compactor.compactResults(rawResults, 5),
    ];
  }

  async run(rawResults: any[]): Promise<any[]> {
    if (!rawResults?.length) return [];

    const variants = this.buildVariants(rawResults);

    for (let i = 0; i < variants.length; i++) {
      try {
        const content = await this.ai.chatOnce(variants[i]);
        if (!content) return [];

        const cleaned = this.json.extractJson(content);

        let parsed: CandidatesResponse | undefined;
        try {
          parsed = responseSchema.parse(JSON.parse(cleaned));
        } catch (e) {
          logger.warn('AI filtering JSON parse failed', { excerpt: cleaned.slice(0, 200) });
          throw e;
        }

        return (parsed.candidates || []).map(c => this.norms.normalizeCandidate(c));
      } catch (error: any) {
        const data = error?.response?.data;
        const isTimeout =
          error?.code === 'ECONNABORTED' ||
          /timeout/i.test(error?.message || '') ||
          /request timeout/i.test(error?.message || '');
        const meta = {
          message: error?.message,
          status: error?.response?.status,
          data,
        };
        if (isTimeout) {
          logger.warn(`AI filtering timed out (attempt ${i + 1}); will try a smaller context`, meta);
        } else {
          logger.error(`AI filtering failed (attempt ${i + 1})`, meta);
        }
        if (i === variants.length - 1) return [];
      }
    }

    return [];
  }
}