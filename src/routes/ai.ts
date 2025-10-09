import { Router } from 'express';
import { startSession, nextQuestion, getSession } from '../controllers/ai.controller';

const router = Router();

router.post('/session', startSession);
router.post('/next', nextQuestion);
router.get('/session/:id', getSession);

export default router;