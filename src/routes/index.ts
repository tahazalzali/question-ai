import { Router } from 'express';
import aiRouter from './ai';

const router = Router();

router.use('/ai', aiRouter);

export default router;