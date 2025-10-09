import { Schema, model, Document, Types } from 'mongoose';

export interface ISession extends Document {
  query: string;
  candidates: Types.ObjectId[];
  answers: {
    profession?: string | 'none';
    location?: string | 'none';
    employer?: string | 'none';
    education?: string | 'none';
  };
  flowState: 'q1' | 'q2' | 'q3' | 'q4' | 'done';
  cacheKey: string;
  createdAt: Date;
  updatedAt: Date;
}

const sessionSchema = new Schema<ISession>(
  {
    query: { type: String, required: true },
    candidates: [{ type: Schema.Types.ObjectId, ref: 'Person' }],
    answers: {
      profession: { type: String },
      location: { type: String },
      employer: { type: String },
      education: { type: String },
    },
    flowState: {
      type: String,
      enum: ['q1', 'q2', 'q3', 'q4', 'done'],
      default: 'q1',
    },
    cacheKey: { type: String, required: true, index: true },
  },
  {
    timestamps: true,
  },
);

export const Session = model<ISession>('Session', sessionSchema);