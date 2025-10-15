import { logger } from '../../utils/logger';
import { ResultCompactor } from './compactor';
import { JsonExtractor } from './jsonExtractor';
import { PerplexityClient } from './aiClient';
import { responseSchema, type CandidatesResponse, type Candidate } from './schemas';
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

  private cloneCandidate(candidate: Candidate): Candidate {
    return {
      ...candidate,
      professions: [...(candidate.professions || [])],
      employers: [...(candidate.employers || [])],
      education: [...(candidate.education || [])],
      emails: [...(candidate.emails || [])],
      phones: [...(candidate.phones || [])],
      locations: [...(candidate.locations || [])],
      relatedPeople: (candidate.relatedPeople || []).map(rp => ({ ...rp })),
      sources: (candidate.sources || []).map(src => ({ ...src })),
      social: { ...(candidate.social || {}) },
    };
  }

  private mergeSources(
    current: Candidate['sources'] = [],
    incoming: Candidate['sources'] = [],
  ): Candidate['sources'] {
    const merged = new Map<string, { provider: 'perplexity' | 'gemini' | 'brave'; url?: string; note?: string }>();
    const add = (source?: { provider: 'perplexity' | 'gemini' | 'brave'; url?: string; note?: string }) => {
      if (!source?.provider) return;
      const urlKey = (source.url || '').trim().toLowerCase();
      const key = `${source.provider}:${urlKey}`;
      const existing = merged.get(key);
      if (existing) {
        if (!existing.note && source.note) existing.note = source.note;
        return;
      }
      merged.set(key, { provider: source.provider, url: source.url, note: source.note });
    };
    current.forEach(add);
    incoming.forEach(add);
    return Array.from(merged.values());
  }

  private mergeRelatedPeople(
    current: Candidate['relatedPeople'] = [],
    incoming: Candidate['relatedPeople'] = [],
  ): Candidate['relatedPeople'] {
    const merged = new Map<string, NonNullable<Candidate['relatedPeople']>[number]>();
    const add = (person?: NonNullable<Candidate['relatedPeople']>[number]) => {
      if (!person) return;
      const fullName = (person.fullName || '').trim().toLowerCase();
      const linkedin = (person.linkedin || '').trim().toLowerCase();
      const key = `${fullName}:${linkedin}`;
      if (merged.has(key)) return;
      merged.set(key, { ...person });
    };
    current.forEach(add);
    incoming.forEach(add);
    return Array.from(merged.values());
  }

  private mergeCandidateInto(target: Candidate, incoming: Candidate) {
    const take = (current?: string | null, next?: string | null) => {
      const trimmedCurrent = current?.trim() || '';
      const trimmedNext = next?.trim() || '';
      if (trimmedCurrent) return current!;
      if (trimmedNext) return next!;
      return trimmedCurrent ? current! : trimmedNext ? next! : current ?? next ?? null;
    };

    target.fullName = take(target.fullName, incoming.fullName) || target.fullName;
    target.firstName = take(target.firstName ?? null, incoming.firstName ?? null) ?? null;
    target.middleName = take(target.middleName ?? null, incoming.middleName ?? null) ?? null;
    target.lastName = take(target.lastName ?? null, incoming.lastName ?? null) ?? null;

    target.professions = this.norms.uniqCI([...(target.professions || []), ...(incoming.professions || [])]);
    target.employers = this.norms.uniqCI([...(target.employers || []), ...(incoming.employers || [])]);
    target.education = this.norms.uniqCI([...(target.education || []), ...(incoming.education || [])]);
    target.emails = this.norms.uniqCI([...(target.emails || []), ...(incoming.emails || [])]);
    target.phones = this.norms.uniqCI([...(target.phones || []), ...(incoming.phones || [])]);
    target.locations = this.norms.uniqCI([...(target.locations || []), ...(incoming.locations || [])]);

    target.relatedPeople = this.mergeRelatedPeople(target.relatedPeople, incoming.relatedPeople);
    target.sources = this.mergeSources(target.sources, incoming.sources);

    const socialKeys: Array<keyof NonNullable<Candidate['social']>> = ['instagram','twitter', 'linkedin', 'tiktok'];
    target.social = { ...(target.social || {}) };
    socialKeys.forEach(key => {
      const current = target.social?.[key];
      const next = incoming.social?.[key];
      if (!current && next) {
        if (!target.social) target.social = {};
        target.social[key] = next;
      }
    });

    const currentAge = typeof target.age === 'number' ? target.age : null;
    const nextAge = typeof incoming.age === 'number' ? incoming.age : null;
    target.age = currentAge ?? nextAge ?? null;

    const currentConfidence = typeof target.confidence === 'number' ? target.confidence : 0;
    const nextConfidence = typeof incoming.confidence === 'number' ? incoming.confidence : 0;
    target.confidence = Math.max(currentConfidence, nextConfidence);
  }

  private candidateKey(candidate: Candidate): string | null {
    const norm = (value?: string | null) => (value || '').trim().toLowerCase();

    const linkedin = norm(candidate.social?.linkedin);
    if (linkedin) return `ln:${linkedin}`;

    const linkedSource = (candidate.sources || []).find(src =>
      /linkedin\.com\/in\//i.test(src.url || ''),
    );
    if (linkedSource?.url) return `src:${norm(linkedSource.url)}`;

    const email = norm(candidate.emails?.[0]);
    if (email) return `em:${email}`;

    const phone = (candidate.phones?.[0] || '').replace(/\D+/g, '');
    if (phone) return `ph:${phone}`;

    const fullName = norm(candidate.fullName);
    const employer = norm(candidate.employers?.[0]);
    if (fullName && employer) return `ne:${fullName}|${employer}`;

    return fullName || null;
  }

  private mergeCandidates(candidates: Candidate[]): Candidate[] {
    const merged = new Map<string, Candidate>();
    const unmatched: Candidate[] = [];

    candidates.forEach(candidate => {
      const key = this.candidateKey(candidate);
      if (!key) {
        unmatched.push(this.cloneCandidate(candidate));
        return;
      }
      const existing = merged.get(key);
      if (existing) {
        this.mergeCandidateInto(existing, candidate);
      } else {
        merged.set(key, this.cloneCandidate(candidate));
      }
    });

    unmatched.forEach(candidate => {
      merged.set(`${candidate.fullName}:${merged.size + 1}`, this.cloneCandidate(candidate));
    });

    return Array.from(merged.values());
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

        const normalized = (parsed.candidates || []).map(c => this.norms.normalizeCandidate(c));
        const merged = this.mergeCandidates(normalized);
        const preview = merged.slice(0, 5).map(c => ({
          fullName: c.fullName,
          primaryProfession: c.professions?.[0] || null,
          topLocation: c.locations?.[0] || null,
          sources: (c.sources || []).length,
        }));

        logger.info('AI filtering candidates accepted', {
          total: merged.length,
          preview,
        });

        return merged;
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