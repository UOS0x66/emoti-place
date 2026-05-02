import { Router } from 'express';
import authMiddleware from '../middleware/auth.js';
import { recommend } from '../services/recommendService.js';

const router = Router();

// POST /api/recommend - 장소 추천 (3단계 파이프라인 실행)
router.post('/', authMiddleware, async (req, res, next) => {
  try {
    const { session_id, lat, lng } = req.body;

    if (!session_id || lat == null || lng == null) {
      return res.status(400).json({ error: 'session_id, lat, lng를 입력해주세요.' });
    }

    const result = await recommend(session_id, lat, lng);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
