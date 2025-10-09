export class JsonExtractor {
  extractJson(text: string): string {
    const t = (text || '').trim();
    const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const body = fenced ? fenced[1] : t;
    const start = body.indexOf('{');
    const end = body.lastIndexOf('}');
    if (start !== -1 && end !== -1 && end > start) {
      return body.slice(start, end + 1);
    }
    return body;
  }
}