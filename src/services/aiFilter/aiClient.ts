import { createHttpClient, withTimeout } from '../../utils/http';
import { config } from '../../config/env';

export class PerplexityClient {
  private client = createHttpClient(config.openai?.baseUrl ?? 'https://api.openai.com/v1', 65000);

  readonly systemPrompt = `You are a strict information extractor. Use only provided snippets/URLs. Do not invent data.
Rules:
- Merge records that refer to the same person across sources (match by LinkedIn, email, phone, or strong name+employer).
- Consolidate synonymous professions into a single canonical label per person (e.g., "Software Developer" and "Software Engineer" -> "Software Engineer").
- Put the primary role first in "professions". Keep all arrays unique, de-duplicated, and concise.
- Normalize institutions and locations (e.g., use full university names; map common abbreviations like NYC -> New York, USA; USA/US/United States -> United States; UK/United Kingdom -> United Kingdom; Bay Area -> San Francisco Bay Area, USA).
- Prefer direct, canonical URLs (e.g., https://www.linkedin.com/in/...); avoid redirector/tracking URLs.
- When a snippet mentions a person tied to an organization-focused result (founder, owner, director, "also known as", etc.), extract that individual even if the title is about the venue/company. Use snippet context to determine the person's canonical name and relation.
- Capture alias or nickname variants mentioned in snippets and map them to the same candidate when evidence shows they refer to the same person.
- **CRITICAL: For each candidate, include ALL relevant URLs from the search results where that person (or their alias) is mentioned. Always populate the sources array with the provider and url fields.**
- If a result mentions the person by alias (e.g., "Abou George" for "Arairo"), include that result's URL in sources with a note explaining the connection.
- If unknown, output null or omit.
- Never fabricate information.
Output only raw JSON as a single object. No markdown, no code fences, no additional text.`;

  buildUserPrompt(compact: unknown[]): string {
    return `From these search results, extract real people and return STRICT JSON per the schema.
Provide candidates even when a result primarily describes an organization but the snippet supplies a person clearly linked to the query (e.g., "Arairo's Pottery … also known as Abou George"). Use snippet context to resolve aliases and confirm relevance.

**IMPORTANT: When extracting a person mentioned via alias, business name, or indirect reference, include the corresponding search result URL in their sources array with a descriptive note.**

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
    "sources": [{"provider":"perplexity|gemini|brave","url":"string","note":"string"}], // REQUIRED: include all relevant URLs with notes
    "confidence": 0.0-1.0
  }...]
}

Rules:
- Merge duplicates across sources into one candidate.
- Canonicalize professions (avoid near-duplicate titles like "Software Developer" vs "Software Engineer").
- Use direct URLs only; if a LinkedIn handle is present, convert to full LinkedIn profile URL.
- **Every candidate MUST have at least one source entry with provider and url. If extracting from an organization-focused result, include that URL and explain the connection in the note field (e.g., "Mentioned as owner/founder of [business name]").**

Strictly return only the JSON object. No backticks or explanations.
INPUT: ${JSON.stringify(compact)}`;
  }

  async chatOnce(compact: unknown[], timeoutMs = 60000): Promise<string> {
    const response = await withTimeout(
      this.client.post(
        '/chat/completions',
        {
          messages: [
            { role: 'system', content: this.systemPrompt },
            { role: 'user', content: this.buildUserPrompt(compact) },
          ],
          model: 'gpt-4.1',
          temperature: 0.1,
        },
        {
          headers: {
            Authorization: `Bearer ${config.openai?.apiKey}`,
          },
        },
      ),
      timeoutMs,
      'AI filtering request timeout',
    );

    return response.data?.choices?.[0]?.message?.content || '';
  }
}