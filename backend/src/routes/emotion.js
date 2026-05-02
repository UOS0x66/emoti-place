import { Router } from 'express';
import authMiddleware from '../middleware/auth.js';
import { getEmotions } from '../services/emotionService.js';

const router = Router();

// GET /api/emotion/:session_id - 감정 스코어 조회
router.get('/:session_id', authMiddleware, async (req, res, next) => {
  try {
    const emotions = await getEmotions(req.params.session_id);
    res.json(emotions);
  } catch (err) {
    next(err);
  }
});

export default router;
