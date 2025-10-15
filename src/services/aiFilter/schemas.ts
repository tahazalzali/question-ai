import { z } from 'zod';

const stringArray = z
  .array(z.union([z.string(), z.null(), z.undefined()]))
  .default([])
  .transform(arr =>
    arr
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0),
  );

export const candidateSchema = z.object({
  fullName: z.string(),
  firstName: z.string().nullable().optional(),
  middleName: z.string().nullable().optional(),
  lastName: z.string().nullable().optional(),
  professions: stringArray,
  employers: stringArray,
  education: stringArray,
  emails: stringArray,
  phones: stringArray,
  social: z
    .object({
      instagram: z.string().nullable().optional(),
      facebook: z.string().nullable().optional(),
      twitter: z.string().nullable().optional(),
      linkedin: z.string().nullable().optional(),
      tiktok: z.string().nullable().optional(),
    })
    .default({}),
  age: z.number().nullable().optional(),
  gender: z.enum(['male', 'female', 'other']).nullable().optional(),
  locations: stringArray,
  relatedPeople: z
    .array(
      z.object({
        fullName: z.string(),
        relation: z.string().nullable().optional(),
        linkedin: z.string().nullable().optional(),
      }),
    )
    .default([]),
  sources: z
    .array(
      z.object({
        provider: z.enum(['perplexity', 'gemini', 'brave']),
        url: z.string().optional().nullable(),
        note: z.string().optional().nullable(),
      }),
    )
    .default([])
    .transform(arr =>
      arr
        .filter(src => !!src?.provider)
        .map(src => ({
          provider: src.provider,
          url: src.url ?? undefined,
          note: src.note ?? undefined,
        })),
    ),
  confidence: z.number().min(0).max(1).default(0.5),
});

export const responseSchema = z.object({
  candidates: z.array(candidateSchema).default([]),
});

export type Candidate = z.infer<typeof candidateSchema>;
export type CandidatesResponse = z.infer<typeof responseSchema>;