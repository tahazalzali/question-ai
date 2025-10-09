export type RawResult = { title?: string; url?: string; link?: string; snippet?: string; provider?: string };

export class ResultCompactor {
  private trim(s?: string, n = 300) {
    return s ? s.slice(0, n) : '';
  }

  compactResults(rawResults: RawResult[], cap = 12) {
    return (rawResults || []).slice(0, cap).map(r => ({
      title: this.trim(r.title || '', 160),
      url: r.url || r.link || '',
      snippet: this.trim(r.snippet || '', 500),
      provider: r.provider,
    }));
  }
}