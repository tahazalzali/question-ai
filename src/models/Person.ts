import { Schema, model, Document } from 'mongoose';

export interface SocialURLs {
  instagram?: string | null;
  facebook?: string | null;
  twitter?: string | null;
  linkedin?: string | null;
  tiktok?: string | null;
}

export interface RelatedPerson {
  fullName: string;
  relation?: string | null;
  linkedin?: string | null;
}

export interface IPerson extends Document {
  _id: string;
  fullName: string;
  firstName?: string | null;
  middleName?: string | null;
  lastName?: string | null;
  professions: string[];
  employers: string[];
  education: string[];
  emails: string[];
  phones: string[];
  social: SocialURLs;
  age?: number | null;
  gender?: 'male' | 'female' | 'other' | null;
  locations: string[];
  relatedPeople: RelatedPerson[];
  sources: { provider: 'perplexity' | 'gemini' | 'brave'; url?: string; note?: string }[];
  confidence: number;
  createdAt: Date;
  updatedAt: Date;
}

const personSchema = new Schema<IPerson>(
  {
    fullName: { type: String, required: true, index: true },
    firstName: { type: String, default: null },
    middleName: { type: String, default: null },
    lastName: { type: String, default: null },
    professions: [{ type: String }],
    employers: [{ type: String }],
    education: [{ type: String }],
    emails: [{ type: String }],
    phones: [{ type: String }],
    social: {
      instagram: { type: String, default: null },
      facebook: { type: String, default: null },
      twitter: { type: String, default: null },
      linkedin: { type: String, default: null, index: true },
      tiktok: { type: String, default: null },
    },
    age: { type: Number, default: null },
    gender: { type: String, enum: ['male', 'female', 'other', null], default: null },
    locations: [{ type: String }],
    relatedPeople: [
      {
        fullName: { type: String, required: true },
        relation: { type: String, default: null },
        linkedin: { type: String, default: null },
      },
    ],
    sources: [
      {
        provider: { type: String, enum: ['perplexity', 'gemini', 'brave'], required: true },
        url: { type: String },
        note: { type: String },
      },
    ],
    confidence: { type: Number, min: 0, max: 1, required: true },
  },
  {
    timestamps: true,
  },
);

personSchema.index({ fullName: 1, 'social.linkedin': 1 });

export const Person = model<IPerson>('Person', personSchema);