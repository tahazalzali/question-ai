import { z } from 'zod';

export const candidateSchema = z.object({
  fullName: z.string(),
  firstName: z.string().nullable().optional(),
  middleName: z.string().nullable().optional(),
  lastName: z.string().nullable().optional(),
  professions: z.array(z.string()).default([]),
  employers: z.array(z.string()).default([]),
  education: z.array(z.string()).default([]),
  emails: z.array(z.string()).default([]),
  phones: z.array(z.string()).default([]),
  social: z.object({
    instagram: z.string().nullable().optional(),
    facebook: z.string().nullable().optional(),
    twitter: z.string().nullable().optional(),
    linkedin: z.string().nullable().optional(),
    tiktok: z.string().nullable().optional(),
  }).default({}),
  age: z.number().nullable().optional(),
  gender: z.enum(['male', 'female', 'other']).nullable().optional(),
  locations: z.array(z.string()).default([]),
  relatedPeople: z.array(z.object({
    fullName: z.string(),
    relation: z.string().nullable().optional(),
    linkedin: z.string().nullable().optional(),
  })).default([]),
  sources: z.array(z.object({
    provider: z.enum(['perplexity', 'gemini', 'brave']),
    url: z.string().optional(),
    note: z.string().optional(),
  })).default([]),
  confidence: z.number().min(0).max(1).default(0.5),
});

export const responseSchema = z.object({
  candidates: z.array(candidateSchema).default([]),
});

export type Candidate = z.infer<typeof candidateSchema>;
export type CandidatesResponse = z.infer<typeof responseSchema>;