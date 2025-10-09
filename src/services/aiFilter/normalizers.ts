import { normalizeEmail, normalizePhone } from '../../utils/http';
import type { Candidate } from './schemas';

export class CandidateNormalizers {
  uniqCI(arr: string[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const v of (arr || []).filter(Boolean)) {
      const key = v.trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(v.trim());
    }
    return out;
  }

  canonicalizeLinkedIn(link?: string | null): string | null {
    if (!link) return null;
    const ln = link.trim();
    if (!ln) return null;
    if (/^https?:\/\//i.test(ln)) return ln;
    const handle = ln.replace(/^@/, '').replace(/^in\//, '');
    return `https://www.linkedin.com/in/${handle}`;
  }

  canonicalizeLocation(loc: string): string {
    const s = (loc || '').trim();
    if (!s) return s;

    const lower = s.toLowerCase();
    const us = /^(us|usa|u\.s\.a\.|united states|united states of america)$/i;
    const uk = /^(uk|u\.k\.|united kingdom|england|scotland|wales|northern ireland)$/i;
    const nyc = /^(nyc|new york city)$/i;
    const sfba = /^(bay area|sfo|san francisco bay area)$/i;

    if (us.test(lower)) return 'United States';
    if (uk.test(lower)) return 'United Kingdom';
    if (nyc.test(lower) || lower.includes('new york, ny')) return 'New York, USA';
    if (sfba.test(lower)) return 'San Francisco Bay Area, USA';

    return s.replace(/\s*,\s*/g, ', ').replace(/\s+/g, ' ').trim();
  }

  normalizeCandidate(c: Candidate): Candidate {
    const linkedin = this.canonicalizeLinkedIn(c.social?.linkedin || null);
    const sources =
      Array.isArray(c.sources)
        ? Array.from(new Map(
            c.sources.map(s => [`${s.provider}:${s.url || ''}`, s]),
          ).values())
        : [];

    return {
      ...c,
      professions: this.uniqCI(c.professions),
      employers: this.uniqCI(c.employers),
      education: this.uniqCI(c.education),
      emails: this.uniqCI((c.emails || []).map(normalizeEmail)),
      phones: this.uniqCI((c.phones || []).map(normalizePhone)),
      locations: this.uniqCI((c.locations || []).map(loc => this.canonicalizeLocation(loc))),
      social: { ...c.social, linkedin },
      sources,
    };
  }
}