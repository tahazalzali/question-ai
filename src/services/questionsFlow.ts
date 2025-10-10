import { Session, ISession } from '../models/Session';
import { IPerson } from '../models/Person';

import { logger } from '../utils/logger';
import { Types } from 'mongoose';
import { searchAndExtractCached } from './search';
import { getCache, setCache } from './cache';

interface QuestionOption {
  id: string;
  label: string;
  value: string;
}

interface Question {
  questionId: 'q1' | 'q2' | 'q3' | 'q4' | 'done';
  title: string;
  type: 'single_select';
  options: QuestionOption[];
  hasNoneOfThese: boolean;
  selectedOptionId: string | null;
  context: { sessionId: string };
  nextOnSelect: 'q2' | 'q3' | 'q4' | 'done';
}

interface FinalResults {
  questionId: 'done';
  results: any[];
  cacheUsed: boolean;
}

// New: terminal response when all four answers are "none"
interface NoMatch {
  questionId: 'no_match';
}

// Bump caps for q3/q4 to show more options
const BASE_MAX_OPTIONS = { q1: 15, q2: 15, q3: 25, q4: 25 } as const;
const EXTENDED_MAX_OPTIONS = { q1: 30, q2: 30, q3: 40, q4: 40 } as const;

// Disable all secondary (re-)search/expansion after the initial search
const SECONDARY_SEARCH_ENABLED = false as const;

// Determine a wider cap for options if user selected "none" earlier.
function getMaxOptionsFor(session: ISession, qid: 'q1' | 'q2' | 'q3' | 'q4'): number {
  switch (qid) {
    case 'q1':
      return BASE_MAX_OPTIONS.q1;
    case 'q2':
      return session.answers.profession === 'none' ? EXTENDED_MAX_OPTIONS.q2 : BASE_MAX_OPTIONS.q2;
    case 'q3':
      return (session.answers.location === 'none' || session.answers.profession === 'none')
        ? EXTENDED_MAX_OPTIONS.q3
        : BASE_MAX_OPTIONS.q3;
    case 'q4':
      return (
        session.answers.employer === 'none' ||
        session.answers.location === 'none' ||
        session.answers.profession === 'none'
      )
        ? EXTENDED_MAX_OPTIONS.q4
        : BASE_MAX_OPTIONS.q4;
  }
}

// Add small helpers for case-insensitive matching
const norm = (s: string) => (s || '').trim().toLowerCase();
const hasProfessionCI = (c: IPerson, selected: string) =>
  (c.professions || []).some(p => norm(p) === norm(selected));
const includesCI = (arr: string[] = [], v?: string | null) => {
  if (!v) return false;
  const nv = norm(v);
  return arr.some(x => norm(x) === nv);
};

// General fuzzy text matching (case/diacritics-insensitive, token overlap)
const stripDiacritics = (s: string) =>
  (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const canonText = (s: string) =>
  stripDiacritics(s || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ');

const textTokens = (s: string) => canonText(s).split(' ').filter(Boolean);

const jaccard = (a: string[], b: string[]) => {
  if (!a.length || !b.length) return 0;
  const A = new Set(a);
  const B = new Set(b);
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  const uni = A.size + B.size - inter;
  return uni === 0 ? 0 : inter / uni;
};

const looseMatch = (a?: string | null, b?: string | null, minJaccard = 0.5): boolean => {
  if (!a || !b) return false;
  const ca = canonText(a);
  const cb = canonText(b);
  if (!ca || !cb) return false;
  if (ca === cb) return true;
  if (ca.includes(cb) || cb.includes(ca)) return true;
  return jaccard(textTokens(ca), textTokens(cb)) >= minJaccard;
};

const includesCILoose = (arr: string[] = [], v?: string | null): boolean => {
  if (!v) return false;
  const nv = (v || '').trim();
  return arr.some(x => looseMatch(x, nv));
};

const hasProfessionLoose = (c: IPerson, selected: string): boolean =>
  (c.professions || []).some(p => looseMatch(p, selected));


const canonLoc = (s: string) =>
  stripDiacritics(s)
    .toLowerCase()
    .trim()
    .replace(/-/g, ' ')
    .replace(/\s*,\s*/g, ', ')
    .replace(/\s+/g, ' ');
const LOC_STOP = new Set(['city', 'province', 'state', 'governorate', 'region', 'area', 'district']);
const locTokens = (s: string) =>
  canonLoc(s)
    .split(/[, ]+/)
    .filter(w => w && !LOC_STOP.has(w) && w.length > 1);

function isLocationMatch(a?: string | null, b?: string | null): boolean {
  const ca = canonLoc(a || '');
  const cb = canonLoc(b || '');
  if (!ca || !cb) return false;
  if (ca === cb) return true;
  if (cb.includes(ca) || ca.includes(cb)) return true;
  const ta = locTokens(a || '');
  const tb = locTokens(b || '');
  if (!ta.length || !tb.length) return false;
  // selected tokens subset of candidate tokens
  return ta.every(t => tb.includes(t)) || tb.every(t => ta.includes(t));
}

const includesLocation = (arr: string[] = [], v?: string | null) => {
  if (!v) return false;
  return arr.some(x => isLocationMatch(x, v));
};

// NEW: option label sanitation and “unknown” filtering (display-only)
const normalizeKeyCI = (s: string) => (s || '').trim().toLowerCase();

const isUnknownish = (s: string): boolean => {
  const k = normalizeKeyCI(s);
  if (!k) return true;
  const BAD = new Set([
    'unknown',
    'unk',
    'n/a',
    'na',
    'none',
    'null',
    'not specified',
    'unspecified',
    'not applicable',
    '-',
    '—',
  ]);
  if (BAD.has(k)) return true;
  return /^unknown\b/.test(k) || /^n\/?a$/.test(k);
};

const removeLeadingEnumeration = (s: string): string =>
  (s || '')
    // 1)  1.  (1)  1)  1-  [1]  etc.
    .replace(/^\s*[\(\[\{]?\s*\d+\s*[\)\]\}\.\-:]\s*/u, '')
    // bullets like "- " or "• "
    .replace(/^\s*[•\-]\s+/u, '')
    .replace(/\s+/g, ' ')
    .trim();

// For display: clean numbering/bullets, keep original casing/content
const displayLabel = (s: string): string => removeLeadingEnumeration(s);

// Aggregate counts case-insensitively while preserving the first original form
type CountAgg = Map<string, { label: string; count: number }>;
const incrCount = (agg: CountAgg, raw: string) => {
  const t = (raw || '').trim();
  if (!t || isUnknownish(t)) return;
  const key = normalizeKeyCI(t);
  const cur = agg.get(key);
  if (cur) cur.count += 1;
  else agg.set(key, { label: t, count: 1 });
};

const EDU_CERT_PATTERNS = [
  /\bcertificate\b/i,
  /\bcertification\b/i,
  /\bcertified\b/i,
  /\blicense\b/i,
  /\blicence\b/i,
  /\bcredential\b/i,
  /\bworkshop\b/i,
  /\btraining\b/i,
  /\bbootcamp\b/i,
  /\bshort course\b/i,
];
const EDU_DEGREE_HINT_PATTERNS = [
  /\buniversity\b/i,
  /\bcollege\b/i,
  /\bschool\b/i,
  /\bacademy\b/i,
  /\binstitute\b/i,
  /\binstitut\b/i,
  /\bpolytechnic\b/i,
  /\biiit\b/i,
  /\bbachelor'?s?\b/i,
  /\bmaster'?s?\b/i,
  /\bb\.?s\.?\b/i,
  /\bm\.?s\.?\b/i,
  /\bbsc\b/i,
  /\bmsc\b/i,
  /\bphd\b/i,
  /\bdoctor\b/i,
  /\bmba\b/i,
  /\bjd\b/i,
  /\bmd\b/i,
];

const isLikelyCertificationEntry = (entry: string): boolean =>
  EDU_CERT_PATTERNS.some(re => re.test(entry));

const hasHigherEducationHint = (entry: string): boolean =>
  EDU_DEGREE_HINT_PATTERNS.some(re => re.test(entry));

const sanitizeEducationEntries = (entries: string[] = []): string[] => {
  const dedup = new Map<string, string>();
  for (const raw of entries) {
    const trimmed = (raw || '').trim();
    if (!trimmed || isUnknownish(trimmed)) continue;
    const cleaned = displayLabel(trimmed);
    if (!hasHigherEducationHint(cleaned)) continue;
    if (isLikelyCertificationEntry(cleaned)) continue;
    const key = normalizeKeyCI(cleaned);
    if (!key || dedup.has(key)) continue;
    dedup.set(key, cleaned);
  }
  return Array.from(dedup.values());
};

// Build query variants to expand search when "none" is selected
function buildQueryVariantsForExpansion(session: ISession, answeredQ: 'q1' | 'q2' | 'q3' | 'q4'): string[] {
  const base = (session.query || '').trim();
  const prof = session.answers.profession && session.answers.profession !== 'none' ? session.answers.profession : '';
  const loc = session.answers.location && session.answers.location !== 'none' ? session.answers.location : '';
  const emp = session.answers.employer && session.answers.employer !== 'none' ? session.answers.employer : '';
  const edu = session.answers.education && session.answers.education !== 'none' ? session.answers.education : '';

  const uniq = (arr: string[]) => Array.from(new Set(arr.filter(Boolean).map(s => s.trim())));

  switch (answeredQ) {
    case 'q1':
      return uniq([
        `${base} site:linkedin.com/in`,
        `${base} LinkedIn profile`,
        `${base} profile site:linkedin.com`,
        `${base} people LinkedIn`,
      ]);
    case 'q2':
      // Include selected location to better intersect with profession
      if (loc) {
        return uniq([
          `${base} ${prof} ${loc} site:linkedin.com/in`,
          `${base} ${prof} ${loc} LinkedIn`,
          `"${base}" ${prof} ${loc} site:linkedin.com`,
          `${base} ${prof} ${loc} people LinkedIn`,
          // fallback without loc
          `${base} ${prof} site:linkedin.com/in`,
        ]);
      }
      // No location yet, keep original broad variants
      return uniq([
        `${base} ${prof} site:linkedin.com/in`,
        `${base} ${prof} LinkedIn`,
        `${prof} "${base}" site:linkedin.com`,
        `${base} ${prof} people`,
      ]);
    case 'q3':
      return uniq([
        `${base} ${prof} ${loc} site:linkedin.com/in`,
        `${base} ${prof} ${loc} LinkedIn`,
        `"${base}" ${prof} ${loc} site:linkedin.com`,
        `${base} ${loc} people LinkedIn`,
      ]);
    case 'q4':
      return uniq([
        `${base} ${emp} site:linkedin.com/in`,
        `${base} ${emp} LinkedIn`,
        `${base} ${prof} ${emp} site:linkedin.com`,
        `${base} ${edu} alumni LinkedIn`,
      ]);
    default:
      return uniq([`${base} site:linkedin.com/in`, `${base} LinkedIn`]);
  }
}

// In-memory lock to prevent concurrent expansions per session
const expansionLocks = new Set<string>();

// Stable fingerprint of expansion attempt for short-lived de-dupe
function expansionFingerprint(session: ISession, answeredQ: 'q1' | 'q2' | 'q3' | 'q4' | 'final') {
  return JSON.stringify({
    sid: session.id,
    q: (session.query || '').trim().toLowerCase(),
    answers: session.answers,
    step: answeredQ,
  });
}

function shouldSkipExpansion(session: ISession, answeredQ: 'q1' | 'q2' | 'q3' | 'q4' | 'final') {
  const fp = expansionFingerprint(session, answeredQ);
  const key = `expand:${session.id}:${fp}`;
  const hit = getCache<boolean>(key);
  return hit.hit && hit.value === true;
}

function markExpansionAttempt(session: ISession, answeredQ: 'q1' | 'q2' | 'q3' | 'q4' | 'final') {
  const fp = expansionFingerprint(session, answeredQ);
  const key = `expand:${session.id}:${fp}`;
  // 3 minutes de-dupe window
  setCache(key, true, 3 * 60 * 1000);
}

function filterCandidatesForSession(session: ISession, candidates: IPerson[]): IPerson[] {
  let final = candidates;

  if (session.answers.profession && session.answers.profession !== 'none') {
    final = final.filter(c => (c.professions || []).some(p => norm(p) === norm(session.answers.profession!)));
  }
  if (session.answers.location && session.answers.location !== 'none') {
    final = final.filter(c => includesLocation(c.locations, session.answers.location!));
  }
  if (session.answers.employer && session.answers.employer !== 'none') {
    final = final.filter(c => includesCI(c.employers, session.answers.employer!));
  }
  if (session.answers.education && session.answers.education !== 'none') {
    final = final.filter(c => includesCI(c.education, session.answers.education!));
  }
  return final;
}

function filterCandidatesForSessionRelaxed(session: ISession, candidates: IPerson[]): IPerson[] {
  let final = candidates;

  if (session.answers.profession && session.answers.profession !== 'none') {
    final = final.filter(c => hasProfessionLoose(c, session.answers.profession!));
  }
  if (session.answers.location && session.answers.location !== 'none') {
    final = final.filter(c => includesLocation(c.locations, session.answers.location!)); // already fuzzy
  }
  if (session.answers.employer && session.answers.employer !== 'none') {
    final = final.filter(c => includesCILoose(c.employers, session.answers.employer!));
  }
  if (session.answers.education && session.answers.education !== 'none') {
    final = final.filter(c => includesCILoose(c.education, session.answers.education!));
  }
  return final;
}

// Expand session candidates using AI search if "none" was selected
// NOTE: kept for backward-compatibility, but no longer invoked when user selects "none".
async function expandCandidatesAfterSelection(
  session: ISession,
  candidates: IPerson[],
  answeredQ: 'q1' | 'q2' | 'q3' | 'q4',
): Promise<IPerson[]> {
  try {
    if (shouldSkipExpansion(session, answeredQ)) return [];
    if (expansionLocks.has(session.id)) return [];
    expansionLocks.add(session.id);

    const queries = buildQueryVariantsForExpansion(session, answeredQ);
    if (!queries.length) {
      markExpansionAttempt(session, answeredQ);
      return [];
    }

    const existingIds = new Set<string>(candidates.map(c => String(c._id)));
    const newlyFound: IPerson[] = [];

    for (const q of queries) {
      const persons = await searchAndExtractCached(q);
      for (const p of persons) {
        const pid = String(p._id);
        if (!existingIds.has(pid)) {
          existingIds.add(pid);
          newlyFound.push(p);
        }
      }
      // Stop as soon as we add any
      if (newlyFound.length > 0) break;
    }

    if (newlyFound.length) {
      const newIds = newlyFound.map(p => new Types.ObjectId(p._id));
      session.candidates.push(...newIds);
      await session.save();
      logger.info('Expanded session candidates after selection', {
        sessionId: session.id,
        answeredQ,
        added: newlyFound.length,
      });
    }

    markExpansionAttempt(session, answeredQ);
    return newlyFound;
  } catch (err: any) {
    logger.warn('Failed to expand candidates after selection', { message: err?.message });
    return [];
  } finally {
    expansionLocks.delete(session.id);
  }
}

// Resolve selected option (by id or raw label) to a canonical value.
// Returns 'none' for the special "None of these" option.
async function resolveSelectedValueForAnswer(
  session: ISession,
  candidates: IPerson[],
  questionId: string,
  selected: string,
): Promise<string> {
  const sel = (selected || '').trim();
  const selLower = sel.toLowerCase();
  if (!sel || selLower === 'none' || selLower === 'none of these') return 'none';

  type QID = 'q1' | 'q2' | 'q3' | 'q4';
  const deduceQid = (): QID => {
    if (/^prof_\d+$/i.test(sel)) return 'q1';
    if (/^loc_\d+$/i.test(sel)) return 'q2';
    if (/^emp_\d+$/i.test(sel)) return 'q3';
    if (/^edu_\d+$/i.test(sel)) return 'q4';
    return (['q1', 'q2', 'q3', 'q4'].includes(questionId) ? questionId : 'q1') as QID;
  };

  const qid = deduceQid();

  const buildOptionsFor = (qid: QID): QuestionOption[] => {
    switch (qid) {
      case 'q1': {
        const counts = new Map<string, { label: string; count: number }>();
        for (const c of candidates) {
          const primary = (c.professions?.[0] || '').trim();
          if (!primary || isUnknownish(primary)) continue;
          const key = primary.toLowerCase();
          const cur = counts.get(key);
          if (cur) cur.count += 1;
          else counts.set(key, { label: primary, count: 1 });
        }
        return Array.from(counts.values())
          .sort((a, b) => (b.count - a.count) || a.label.localeCompare(b.label))
          .map((p, i) => ({ id: `prof_${i}`, label: displayLabel(p.label), value: p.label }))
          .slice(0, getMaxOptionsFor(session, 'q1'));
      }
      case 'q2': {
        const counts: CountAgg = new Map();
        let filtered = candidates;
        if (session.answers.profession && session.answers.profession !== 'none') {
          filtered = candidates.filter(c => hasProfessionCI(c, session.answers.profession!));
        }
        const add = (list: IPerson[]) => list.forEach(c => (c.locations || []).forEach(l => incrCount(counts, l)));
        if (filtered.length) {
          add(filtered);
          if (counts.size === 0) add(candidates);
        } else add(candidates);
        return Array.from(counts.values())
          .sort((a, b) => (b.count - a.count) || a.label.localeCompare(b.label))
          .map((e, i) => ({ id: `loc_${i}`, label: displayLabel(e.label), value: e.label }))
          .slice(0, getMaxOptionsFor(session, 'q2'));
      }
      case 'q3': {
        const counts: CountAgg = new Map();
        let filtered = candidates;
        if (session.answers.location && session.answers.location !== 'none') {
          filtered = candidates.filter(c => includesLocation(c.locations, session.answers.location!));
        }
        const add = (list: IPerson[]) => list.forEach(c => (c.employers || []).forEach(e => incrCount(counts, e)));
        if (filtered.length) add(filtered);
        else add(candidates);
        return Array.from(counts.values())
          .sort((a, b) => (b.count - a.count) || a.label.localeCompare(b.label))
          .map((e, i) => ({ id: `emp_${i}`, label: displayLabel(e.label), value: e.label }))
          .slice(0, getMaxOptionsFor(session, 'q3'));
      }
      case 'q4': {
        const counts: CountAgg = new Map();
        let filtered = candidates;
        if (session.answers.employer && session.answers.employer !== 'none') {
          filtered = candidates.filter(c => includesCI(c.employers, session.answers.employer!));
        }
        const add = (list: IPerson[]) => list.forEach(c => (c.education || []).forEach(e => incrCount(counts, e)));
        if (filtered.length) add(filtered);
        else add(candidates);
        return Array.from(counts.values())
          .sort((a, b) => (b.count - a.count) || a.label.localeCompare(b.label))
          .map((e, i) => ({ id: `edu_${i}`, label: displayLabel(e.label), value: e.label }))
          .slice(0, getMaxOptionsFor(session, 'q4'));
      }
    }
  };

  const options = buildOptionsFor(qid);

  // 1) Match by generated id (prof_*, loc_*, emp_*, edu_*)
  const byId = options.find(o => o.id.toLowerCase() === selLower);
  if (byId) return byId.value;

  // 2) Match by label/value (case-insensitive)
  const byLabel = options.find(o => (o.label || '').toLowerCase() === selLower);
  if (byLabel) return byLabel.value;
  const byValue = options.find(o => (o.value || '').toLowerCase() === selLower);
  if (byValue) return byValue.value;

  // 3) Fuzzy location fallback
  if (qid === 'q2') {
    const all = new Set<string>();
    candidates.forEach(c => (c.locations || []).forEach(l => { if (!isUnknownish(l)) all.add(l); }));
    for (const l of all) {
      if (isLocationMatch(l, sel)) return l;
    }
  }

  // 4) Accept raw text; downstream filters are case-insensitive/fuzzy
  return sel;
}

export async function buildNextQuestion(
  sessionId: string,
  answer?: { questionId: string; selected: string },
): Promise<Question | FinalResults | NoMatch> {
  const session = await Session.findById(sessionId).populate('candidates');
  if (!session) throw new Error('Session not found');

  const candidates = session.candidates as unknown as IPerson[];

  logger.info('buildNextQuestion enter', {
    sessionId,
    flowState: session.flowState,
    candidatesCount: candidates.length,
    hasAnswer: !!answer,
  });

  // Update answers if provided (accept both option ids and raw labels)
  if (answer) {
    const resolved = await resolveSelectedValueForAnswer(session, candidates, answer.questionId, answer.selected);
    logger.info('Answer resolved', { sessionId, qid: answer.questionId, selected: answer.selected, resolved });

    switch (answer.questionId) {
      case 'q1':
        session.answers.profession = resolved;
        session.flowState = 'q2';
        break;
      case 'q2':
        session.answers.location = resolved;
        {
          const prof = session.answers.profession ?? 'none';
          const loc = session.answers.location ?? 'none';
          const nonNone = (prof === 'none' ? 0 : 1) + (loc === 'none' ? 0 : 1);
          session.flowState = nonNone === 2 ? 'done' : 'q3';
        }
        break;
      case 'q3':
        session.answers.employer = resolved;
        {
          const bothFirstTwoNone =
            (session.answers.profession ?? 'none') === 'none' &&
            (session.answers.location ?? 'none') === 'none';
          session.flowState = bothFirstTwoNone ? 'q4' : 'done';
        }
        break;
      case 'q4':
        session.answers.education = resolved;
        session.flowState = 'done';
        break;
    }

    // If user selected "none", do NOT search again; just proceed and widen option lists next
    if (resolved === 'none') {
      const answeredQ = answer.questionId as 'q1' | 'q2' | 'q3' | 'q4';
      logger.info('User selected "none"; skipping search expansion and widening next options', {
        sessionId: session.id,
        answeredQ,
      });
    } else {
      // For non-"none" selection, if no current matches, optionally search more (disabled)
      const matchesNow = filterCandidatesForSession(session, candidates).length;
      if (matchesNow === 0) {
        const answeredQ = answer.questionId as 'q1' | 'q2' | 'q3' | 'q4';
        if (SECONDARY_SEARCH_ENABLED) {
          const newOnes = await expandCandidatesAfterSelection(session, candidates, answeredQ);
          if (newOnes.length) {
            candidates.push(...newOnes);
            logger.info('Expanded after selection due to zero matches', {
              sessionId: session.id,
              answeredQ,
              added: newOnes.length,
              totalCandidates: candidates.length,
            });
          } else {
            logger.info('No expansion results after selection (zero matches persisted)', {
              sessionId: session.id,
              answeredQ,
            });
          }
        } else {
          logger.info('Secondary search disabled; not expanding after selection', {
            sessionId: session.id,
            answeredQ,
          });
        }
      }
    }

    await session.save();
  }

  switch (session.flowState) {
    case 'q1': {
      const q = await buildProfessionQuestion(session, candidates);
      logger.info('Built q1', { sessionId: session.id, optionCount: q.options.length });
      return ensureSelectableQuestion(sessionId, q);
    }
    case 'q2': {
      const q = await buildLocationQuestion(session, candidates);
      logger.info('Built q2', { sessionId: session.id, optionCount: q.options.length });
      return ensureSelectableQuestion(sessionId, q);
    }
    case 'q3': {
      const q = await buildEmployerQuestion(session, candidates);
      logger.info('Built q3', { sessionId: session.id, optionCount: q.options.length });
      return ensureSelectableQuestion(sessionId, q);
    }
    case 'q4': {
      const q = await buildEducationQuestion(session, candidates);
      logger.info('Built q4', { sessionId: session.id, optionCount: q.options.length });
      return ensureSelectableQuestion(sessionId, q);
    }
    case 'done': {
      const fourNoneSelected = ['profession', 'location', 'employer', 'education']
        .every(k => (session.answers as any)[k] === 'none');
      if (fourNoneSelected) {
        logger.info('All four answers were "none"; returning no_match', { sessionId: session.id });
        return { questionId: 'no_match' as const };
      }

      const final = await buildFinalResults(session, candidates); // await async
      logger.info('Built final results', {
        sessionId: session.id,
        resultsCount: final.results.length,
        cacheUsed: final.cacheUsed,
      });
      return final;
    }
    default:
      throw new Error('Invalid flow state');
  }
}

async function buildProfessionQuestion(
  session: ISession,
  candidates: IPerson[],
): Promise<Question> {
  // Count primary professions across candidates, ignoring unknown-ish labels
  const counts = new Map<string, { label: string; count: number }>();
  for (const c of candidates) {
    const primary = (c.professions?.[0] || '').trim();
    if (!primary || isUnknownish(primary)) continue;
    const key = primary.toLowerCase();
    const cur = counts.get(key);
    if (cur) cur.count += 1;
    else counts.set(key, { label: primary, count: 1 });
  }

  const options: QuestionOption[] = Array.from(counts.values())
    .sort((a, b) => (b.count - a.count) || a.label.localeCompare(b.label))
    .map((p, i) => ({
      id: `prof_${i}`,
      // Display smarter label (no "(count)" or numbering)
      label: displayLabel(p.label),
      // Keep value as the original string for exact filtering
      value: p.label,
    }))
    .slice(0, getMaxOptionsFor(session, 'q1'));

  options.push({
    id: 'none',
    label: 'None of these',
    value: 'none',
  });

  return {
    questionId: 'q1',
    title: 'What is their profession?',
    type: 'single_select',
    options,
    hasNoneOfThese: true,
    selectedOptionId: null,
    context: { sessionId: session.id },
    nextOnSelect: 'q2',
  };
}

async function buildLocationQuestion(
  session: ISession,
  candidates: IPerson[],
): Promise<Question> {
  const counts: CountAgg = new Map();

  // Keep options from filtered (if profession selected)
  let filtered = candidates;
  if (session.answers.profession && session.answers.profession !== 'none') {
    filtered = candidates.filter(c => hasProfessionCI(c, session.answers.profession!));
  }

  const addLocationsFrom = (list: IPerson[]) => {
    list.forEach(c =>
      (c.locations || []).forEach(l => incrCount(counts, l)),
    );
  };

  // Prefer filtered; if it yields no locations, fall back to all candidates.
  if (filtered.length) {
    addLocationsFrom(filtered);
    if (counts.size === 0) addLocationsFrom(candidates);
  } else {
    addLocationsFrom(candidates);
  }

  let options: QuestionOption[] = Array.from(counts.values())
    .sort((a, b) => (b.count - a.count) || a.label.localeCompare(b.label))
    .map((entry, i) => ({
      id: `loc_${i}`,
      label: displayLabel(entry.label),
      value: entry.label,
    }));

  if (
    SECONDARY_SEARCH_ENABLED &&
    options.length === 0 &&
    session.answers.profession &&
    session.answers.profession !== 'none'
  ) {
    const added = await expandCandidatesAfterSelection(session, candidates, 'q2');
    if (added.length) {
      const counts2: CountAgg = new Map();
      const addFrom = (list: IPerson[]) => {
        list.forEach(c =>
          (c.locations || []).forEach(l => incrCount(counts2, l)),
        );
      };

      let filtered2 = candidates;
      if (session.answers.profession && session.answers.profession !== 'none') {
        filtered2 = candidates.filter(c => hasProfessionCI(c, session.answers.profession!));
      }

      if (filtered2.length) {
        addFrom(filtered2);
        if (counts2.size === 0) addFrom(candidates);
      } else {
        addFrom(candidates);
      }

      options = Array.from(counts2.values())
        .sort((a, b) => (b.count - a.count) || a.label.localeCompare(b.label))
        .map((entry, i) => ({
          id: `loc_${i}`,
          label: displayLabel(entry.label),
          value: entry.label,
        }));
      logger.info('Location options rebuilt after q2 expansion', {
        sessionId: session.id,
        optionCount: options.length,
      });
    }
  }

  options = options.slice(0, getMaxOptionsFor(session, 'q2'));

  options.push({
    id: 'none',
    label: 'None of these',
    value: 'none',
  });

  return {
    questionId: 'q2',
    title: 'Where are they located?',
    type: 'single_select',
    options,
    hasNoneOfThese: true,
    selectedOptionId: null,
    context: { sessionId: session.id },
    nextOnSelect: 'q3',
  };
}

async function buildEmployerQuestion(
  session: ISession,
  candidates: IPerson[],
): Promise<Question> {
  const counts: CountAgg = new Map();

  let filtered = candidates;
  if (session.answers.location && session.answers.location !== 'none') {
    filtered = candidates.filter(c => includesLocation(c.locations, session.answers.location!));
  }

  const addEmployersFrom = (list: IPerson[]) => {
    list.forEach(c =>
      (c.employers || []).forEach(e => incrCount(counts, e)),
    );
  };

  if (filtered.length) addEmployersFrom(filtered);
  else addEmployersFrom(candidates);

  let options: QuestionOption[] = Array.from(counts.values())
    .sort((a, b) => (b.count - a.count) || a.label.localeCompare(b.label))
    .map((entry, i) => ({
      id: `emp_${i}`,
      label: displayLabel(entry.label),
      value: entry.label,
    }));

  if (
    options.length === 0 &&
    session.answers.location &&
    session.answers.location !== 'none'
  ) {
    const added = await expandCandidatesAfterSelection(session, candidates, 'q3');
    if (added.length) {
      const counts2: CountAgg = new Map();
      const addFrom = (list: IPerson[]) => {
        list.forEach(c =>
          (c.employers || []).forEach(e => incrCount(counts2, e)),
        );
      };

      let filtered2 = candidates;
      if (session.answers.location && session.answers.location !== 'none') {
        filtered2 = candidates.filter(c => includesLocation(c.locations, session.answers.location!));
      }

      if (filtered2.length) addFrom(filtered2);
      else addFrom(candidates);

      options = Array.from(counts2.values())
        .sort((a, b) => (b.count - a.count) || a.label.localeCompare(b.label))
        .map((entry, i) => ({
          id: `emp_${i}`,
          label: displayLabel(entry.label),
          value: entry.label,
        }));

      logger.info('Employer options rebuilt after q3 expansion', {
        sessionId: session.id,
        optionCount: options.length,
      });
    }
  }

  options = options.slice(0, getMaxOptionsFor(session, 'q3'));

  options.push({
    id: 'none',
    label: 'None of these',
    value: 'none',
  });

  return {
    questionId: 'q3',
    title: 'Where do they work?',
    type: 'single_select',
    options,
    hasNoneOfThese: true,
    selectedOptionId: null,
    context: { sessionId: session.id },
    nextOnSelect: 'q4',
  };
}

async function buildEducationQuestion(
  session: ISession,
  candidates: IPerson[],
): Promise<Question> {
  const counts: CountAgg = new Map();

  let filtered = candidates;
  if (session.answers.employer && session.answers.employer !== 'none') {
    filtered = candidates.filter(c => includesCI(c.employers, session.answers.employer!));
  }

  const addEducationFrom = (list: IPerson[]) => {
    list.forEach(c =>
      (c.education || []).forEach(e => incrCount(counts, e)),
    );
  };

  if (filtered.length) addEducationFrom(filtered);
  else addEducationFrom(candidates);

  let options: QuestionOption[] = Array.from(counts.values())
    .sort((a, b) => (b.count - a.count) || a.label.localeCompare(b.label))
    .map((entry, i) => ({
      id: `edu_${i}`,
      label: displayLabel(entry.label),
      value: entry.label,
    }));

  if (options.length === 0) {
    const sanitizedFallback = sanitizeEducationEntries(
      candidates.flatMap(c => c.education || []),
    );
    const rawFallback = Array.from(
      new Set(
        candidates
          .flatMap(c => c.education || [])
          .map(v => (v || '').trim())
          .filter(v => v && !isUnknownish(v)),
      ),
    );
    const fallbackValues = sanitizedFallback.length > 0 ? sanitizedFallback : rawFallback;

    options = fallbackValues
      .map((value, idx) => ({
        id: `edu_fb_${idx}`,
        label: displayLabel(value),
        value,
      }))
      .slice(0, getMaxOptionsFor(session, 'q4'));
  }

  options = options.slice(0, getMaxOptionsFor(session, 'q4'));

  options.push({
    id: 'none',
    label: 'None of these',
    value: 'none',
  });

  return {
    questionId: 'q4',
    title: 'Where did they study?',
    type: 'single_select',
    options,
    hasNoneOfThese: true,
    selectedOptionId: null,
    context: { sessionId: session.id },
    nextOnSelect: 'done',
  };
}

// Helper to apply all session filters to candidates and log counts
function applyAllFilters(session: ISession, candidates: IPerson[]): IPerson[] {
  const before = candidates.length;
  let filtered = candidates;

  if (session.answers.profession && session.answers.profession !== 'none') {
    filtered = filtered.filter(c => hasProfessionCI(c, session.answers.profession!));
  }
  if (session.answers.location && session.answers.location !== 'none') {
    filtered = filtered.filter(c => includesLocation(c.locations, session.answers.location!));
  }
  if (session.answers.employer && session.answers.employer !== 'none') {
    filtered = filtered.filter(c => includesCI(c.employers, session.answers.employer!));
  }
  if (session.answers.education && session.answers.education !== 'none') {
    filtered = filtered.filter(c => includesCI(c.education, session.answers.education!));
  }

  // If strict yields nothing and user selected at least one concrete answer, relax matching
  const nonNoneSelected = ['profession', 'location', 'employer', 'education']
    .some(k => (session.answers as any)[k] && (session.answers as any)[k] !== 'none');

  if (filtered.length === 0 && nonNoneSelected) {
    const relaxed = filterCandidatesForSessionRelaxed(session, candidates);
    logger.info('Applied relaxed filters after zero strict matches', {
      sessionId: session.id,
      before,
      after: relaxed.length,
      answers: session.answers,
    });
    if (relaxed.length > 0) {
      return relaxed;
    }
  }

  logger.info('Applied filters', {
    sessionId: session.id,
    before,
    after: filtered.length,
    answers: session.answers,
  });

  return filtered;
}

// NEW: weighted scoring for best-effort fallback
function weightedScoreCandidate(session: ISession, c: IPerson) {
  let score = 0;
  let strictMatches = 0;

  // Profession: exact > loose
  if (session.answers.profession && session.answers.profession !== 'none') {
    if (hasProfessionCI(c, session.answers.profession)) {
      score += 3;
      strictMatches++;
    } else if (hasProfessionLoose(c, session.answers.profession)) {
      score += 2;
    }
  }

  // Location: fuzzy (treated as strict for our purposes)
  if (session.answers.location && session.answers.location !== 'none') {
    if (includesLocation(c.locations, session.answers.location)) {
      score += 2;
      strictMatches++;
    }
  }

  // Employer: exact > loose
  if (session.answers.employer && session.answers.employer !== 'none') {
    if (includesCI(c.employers, session.answers.employer)) {
      score += 3;
      strictMatches++;
    } else if (includesCILoose(c.employers, session.answers.employer)) {
      score += 2;
    }
  }

  // Education: exact > loose
  if (session.answers.education && session.answers.education !== 'none') {
    if (includesCI(c.education, session.answers.education)) {
      score += 2;
      strictMatches++;
    } else if (includesCILoose(c.education, session.answers.education)) {
      score += 1;
    }
  }

  const contacts = (Array.isArray(c.emails) ? c.emails.length : 0) + (Array.isArray(c.phones) ? c.phones.length : 0);

  return { score, strictMatches, contacts };
}

// Last-chance expansion when final results would be empty
async function ensureNonEmptyFinalCandidates(
  session: ISession,
  candidates: IPerson[],
): Promise<{ final: IPerson[]; expanded: boolean }> {
  let current = applyAllFilters(session, candidates);
  if (current.length > 0) return { final: current, expanded: false };

  // If secondary search is disabled, skip last-chance expansions entirely
  if (!SECONDARY_SEARCH_ENABLED) {
    logger.info('Secondary search disabled; skipping last-chance expansion', { sessionId: session.id });
    return { final: current, expanded: false };
  }

  // De-dupe final-stage expansions for same answers
  if (shouldSkipExpansion(session, 'final')) {
    return { final: current, expanded: false };
  }

  logger.warn('Final candidates empty; attempting last-chance expansion', {
    sessionId: session.id,
    answers: session.answers,
  });

  const order: Array<'q4' | 'q3' | 'q2' | 'q1'> = ['q4', 'q3', 'q2', 'q1'];
  for (const step of order) {
    const added = await expandCandidatesAfterSelection(session, candidates, step);
    if (added.length) {
      candidates.push(...added);
      current = applyAllFilters(session, candidates);
      logger.info('Last-chance expansion step complete', {
        sessionId: session.id,
        step,
        added: added.length,
        matchedAfter: current.length,
      });
      if (current.length > 0) {
        markExpansionAttempt(session, 'final');
        return { final: current, expanded: true };
      }
    } else {
      logger.info('No additions from last-chance expansion step', { sessionId: session.id, step });
    }
  }

  markExpansionAttempt(session, 'final');
  return { final: current, expanded: false };
}

async function buildFinalResults(session: ISession, candidates: IPerson[]): Promise<FinalResults> {
  // Compute final candidates; if empty, try last-chance expansion
  const { final: initialFiltered } = { final: applyAllFilters(session, candidates) };
  let expandedUsed = false;
  let finalCandidates = initialFiltered;

  if (finalCandidates.length === 0) {
    const ensured = await ensureNonEmptyFinalCandidates(session, candidates);
    finalCandidates = ensured.final;
    expandedUsed = ensured.expanded;
  }

  // NEW: best-effort fallback refined — pick only the single best candidate by weighted score.
  let bestEffortUsed = false;
  if (finalCandidates.length === 0) {
    const nonNoneSelected = ['profession', 'location', 'employer', 'education']
      .some(k => (session.answers as any)[k] && (session.answers as any)[k] !== 'none');

    if (nonNoneSelected) {
      const scored = candidates
        .map(c => {
          const m = weightedScoreCandidate(session, c);
          return { c, ...m };
        })
        .filter(x => x.score > 0)
        .sort((a, b) => {
          // primary: weighted score
          if (b.score !== a.score) return b.score - a.score;
          // then: number of strict matches
          if (b.strictMatches !== a.strictMatches) return b.strictMatches - a.strictMatches;
          // then: contacts richness (emails/phones)
          if (b.contacts !== a.contacts) return b.contacts - a.contacts;
          // then: model confidence
          if ((b.c.confidence ?? 0) !== (a.c.confidence ?? 0)) return (b.c.confidence ?? 0) - (a.c.confidence ?? 0);
          // finally: deterministic by name
          return a.c.fullName.localeCompare(b.c.fullName);
        });

      if (scored.length > 0) {
        // Keep only the top candidate in best-effort mode to avoid unrelated extras.
        finalCandidates = [scored[0].c];
        bestEffortUsed = true;
        logger.warn('Final exact match empty; returning single best-effort candidate', {
          sessionId: session.id,
          candidateFullName: scored[0].c.fullName,
          score: scored[0].score,
          strictMatches: scored[0].strictMatches,
        });
      }
    }
  }

  // Determine cacheUsed: cache hit and no selected answer is "none"
    const cached = getCache<IPerson[]>(session.cacheKey);
    const noNoneSelected =
      ['profession', 'location', 'employer', 'education']
        .every((k) => (session.answers as any)[k] === undefined || (session.answers as any)[k] !== 'none');

  const cacheUsed = expandedUsed ? false : !!(cached.hit && noNoneSelected);

  // NEW: when in best-effort fallback, fill missing display fields from selected answers (display-only).
  const results = finalCandidates.map(c => {
    const professionOut =
      (c.professions && c.professions[0]) ||
      (bestEffortUsed && session.answers.profession && session.answers.profession !== 'none'
        ? session.answers.profession
        : null);

    const locationOut =
      (c.locations && c.locations[0]) ||
      (bestEffortUsed && session.answers.location && session.answers.location !== 'none'
        ? session.answers.location
        : null);

    const employerOut =
      (c.employers && c.employers[0]) ||
      (bestEffortUsed && session.answers.employer && session.answers.employer !== 'none'
        ? session.answers.employer
        : null);

    const sanitizedEducation = sanitizeEducationEntries(c.education || []);
    const fallbackEducation =
      bestEffortUsed && session.answers.education && session.answers.education !== 'none'
        ? sanitizeEducationEntries([session.answers.education])
        : [];
    const educationOut = sanitizedEducation.length > 0 ? sanitizedEducation : fallbackEducation;

    return {
      personId: c._id.toString(),
      fullName: c.fullName,
      firstName: c.firstName,
      middleName: c.middleName,
      lastName: c.lastName,
      profession: professionOut,
      location: locationOut,
      employer: employerOut,
      education: educationOut,
      emails: c.emails,
      phones: c.phones,
      social: c.social,
      age: c.age,
      gender: c.gender,
      relatedPeople: c.relatedPeople,
      confidence: c.confidence,
    };
  });

  logger.info('buildFinalResults summary', {
    sessionId: session.id,
    resultsCount: results.length,
    expandedUsed,
    bestEffortUsed,
    cacheHit: cached.hit,
    cacheUsed,
  });

  return {
    questionId: 'done',
    results,
    cacheUsed,
  };
}

// NEW: auto-answering for questions with no selectable options
async function ensureSelectableQuestion(
  sessionId: string,
  question: Question,
): Promise<Question | FinalResults | NoMatch> {
  const hasSelectable = question.options.some(opt => opt.value !== 'none');
  if (hasSelectable) return question;

  logger.info('Auto-answering question with "none" due to lack of options', {
    sessionId,
    questionId: question.questionId,
  });

  return buildNextQuestion(sessionId, {
    questionId: question.questionId,
    selected: 'none',
  });
}