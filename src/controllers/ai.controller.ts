import { Request, Response } from 'express';
import { Types } from 'mongoose';
import { searchAndExtract } from '../services/search';
import { buildNextQuestion } from '../services/questionsFlow';
import { Session } from '../models/Session';
import { Person, IPerson } from '../models/Person';
import { getCache, setCache } from '../services/cache';
import { logger } from '../utils/logger';

const normalizeQuery = (q: string) => q.trim().toLowerCase();
const cacheKeyForQuery = (q: string) => `q:${normalizeQuery(q)}`;

export async function startSession(req: Request, res: Response) {
  try {
    const query: string = (req.body?.query || req.query?.query || '').toString().trim();
    if (!query) return res.status(400).json({ error: 'query is required' });

    const cacheKey = cacheKeyForQuery(query);
    let candidates: IPerson[] = [];

    // Try cache first (ignore empty cached arrays)
    const cached = getCache<IPerson[]>(cacheKey);
    if (cached.hit && Array.isArray(cached.value) && cached.value.length > 0) {
      candidates = cached.value;
      logger.info('Cache hit for query', { query });
    } else {
      candidates = await searchAndExtract(query);
      // Only cache non-empty results
      if (candidates.length > 0) {
        setCache(cacheKey, candidates, 10 * 60 * 1000); // 10 min
        logger.info('Cache miss; searched and cached', { query, count: candidates.length });
      } else {
        logger.info('Cache miss; searched but no candidates found', { query });
      }
    }

    const candidateIds = candidates.map(c => new Types.ObjectId(c._id));
    const session = await Session.create({
      query,
      candidates: candidateIds,
      answers: {},
      flowState: 'q1',
      cacheKey,
    });

    const first = await buildNextQuestion(session.id);
    return res.status(201).json({
      sessionId: session.id,
      question: first,
    });
  } catch (err) {
    logger.error('startSession failed', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function nextQuestion(req: Request, res: Response) {
  try {
    const { sessionId, answer } = req.body || {};
    if (!sessionId) return res.status(400).json({ error: 'sessionId is required' });

    const next = await buildNextQuestion(sessionId, answer);
    return res.json(next);
  } catch (err) {
    logger.error('nextQuestion failed', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function getSession(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const session = await Session.findById(id).populate('candidates');
    if (!session) return res.status(404).json({ error: 'Session not found' });
    return res.json(session);
  } catch (err) {
    logger.error('getSession failed', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}