import { createHttpClient, withTimeout } from '../../utils/http';
import { config } from '../../config/env';

export class PerplexityClient {
  private client = createHttpClient(config.perplexity.baseUrl, 65000);

  readonly systemPrompt = `You are a strict information extractor. Use only provided snippets/URLs. Do not invent data.
Rules:
- Merge records that refer to the same person across sources (match by LinkedIn, email, phone, or strong name+employer).
- Consolidate synonymous professions into a single canonical label per person (e.g., "Software Developer" and "Software Engineer" -> "Software Engineer").
- Put the primary role first in "professions". Keep all arrays unique, de-duplicated, and concise.
- Normalize institutions and locations (e.g., use full university names; map common abbreviations like NYC -> New York, USA; USA/US/United States -> United States; UK/United Kingdom -> United Kingdom; Bay Area -> San Francisco Bay Area, USA).
- Prefer direct, canonical URLs (e.g., https://www.linkedin.com/in/...); avoid redirector/tracking URLs.
- If unknown, output null or omit.
- Never fabricate information.
Output only raw JSON as a single object. No markdown, no code fences, no additional text.`;

  buildUserPrompt(compact: unknown[]): string {
    return `From these search results, extract real people and return STRICT JSON per the schema.
Schema:
{
  "candidates": [{
    "fullName": "string",
    "firstName": "string|null",
    "middleName": "string|null",
    "lastName": "string|null",
    "professions": ["string"], // canonical, unique, primary first
    "employers": ["string"],
    "education": ["string"],
    "emails": ["string"],
    "phones": ["string"],
    "social": { "instagram": "string|null", "facebook": "string|null", "twitter": "string|null", "linkedin": "string|null", "tiktok": "string|null" },
    "age": "number|null",
    "gender": "male|female|other|null",
    "locations": ["string"],
    "relatedPeople": [{"fullName":"string","relation":"string|null","linkedin":"string|null"}],
    "sources": [{"provider":"perplexity|gemini|brave","url":"string","note":"string"}],
    "confidence": 0.0-1.0
  }...]
}
Rules:
- Merge duplicates across sources into one candidate.
- Canonicalize professions (avoid near-duplicate titles like "Software Developer" vs "Software Engineer").
- Use direct URLs only; if a LinkedIn handle is present, convert to full LinkedIn profile URL.
Strictly return only the JSON object. No backticks or explanations.
INPUT: ${JSON.stringify(compact)}`;
  }

  async chatOnce(compact: unknown[], timeoutMs = 60000): Promise<string> {
    const response = await withTimeout(
      this.client.post(
        '/chat/completions',
        {
          model: 'sonar-pro',
          messages: [
            { role: 'system', content: this.systemPrompt },
            { role: 'user', content: this.buildUserPrompt(compact) },
          ],
          temperature: 0,
        },
        {
          headers: {
            Authorization: `Bearer ${config.perplexity.apiKey}`,
          },
        },
      ),
      timeoutMs,
      'AI filtering request timeout',
    );

    return response.data?.choices?.[0]?.message?.content || '';
  }
}