import { z } from 'zod';
import dotenv from 'dotenv';

const isProd = process.env.NODE_ENV === 'production';
if (!isProd) {
  dotenv.config();
}

const envSchema = z.object({
  PORT: z.string().default('3000'),
  MONGODB_URI: z.string(),
  PERPLEXITY_API_KEY: z.string(),
  PERPLEXITY_BASE_URL: z.string().default('https://api.perplexity.ai'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  // Gemini
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_BASE_URL: z.string().default('https://generativelanguage.googleapis.com'),
  GEMINI_MODEL: z.string().default('gemini-2.5-flash'),
  // Vertex (optional, for enterprise web grounding)
  VERTEX_PROJECT_NUMBER: z.string().optional(),
  VERTEX_LOCATION: z.string().default('us-central1'),
  // Brave
  BRAVE_API_KEY: z.string().optional(),
  BRAVE_BASE_URL: z.string().default('https://api.search.brave.com'),
});

const envVars = envSchema.parse(process.env);

export const config = {
  port: parseInt(envVars.PORT, 10),
  mongodb: {
    uri: envVars.MONGODB_URI,
  },
  perplexity: {
    apiKey: envVars.PERPLEXITY_API_KEY,
    baseUrl: envVars.PERPLEXITY_BASE_URL,
  },
  gemini: {
    apiKey: envVars.GEMINI_API_KEY || '',
    baseUrl: envVars.GEMINI_BASE_URL,
    model: envVars.GEMINI_MODEL,
  },
  vertex: {
    projectNumber: envVars.VERTEX_PROJECT_NUMBER || '',
    location: envVars.VERTEX_LOCATION,
  },
  brave: {
    apiKey: envVars.BRAVE_API_KEY || '',
    baseUrl: envVars.BRAVE_BASE_URL,
  },
  env: envVars.NODE_ENV,
  isProduction: envVars.NODE_ENV === 'production',
};
