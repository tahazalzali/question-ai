import { z } from 'zod';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

const isProd = process.env.NODE_ENV === 'production';
const envPath = process.env.DOTENV_PATH || path.resolve(process.cwd(), '.env');

if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
} else if (!isProd) {
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
  // OpenAI
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_BASE_URL: z.string().default('https://api.openai.com/v1'),
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
  // NEW: OpenAI
  openai: {
    apiKey: envVars.OPENAI_API_KEY || '',
    baseUrl: envVars.OPENAI_BASE_URL,
  },
  env: envVars.NODE_ENV,
  isProduction: envVars.NODE_ENV === 'production',
};
