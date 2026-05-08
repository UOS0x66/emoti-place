/**
 * 사용자 장소 피드백 라우트.
 *
 *   POST   /api/feedback           body: { place_id, rating: 'LIKE'|'DISLIKE' }
 *   DELETE /api/feedback/:place_id
 *
 * 모든 라우트 인증 필요 (req.userId 사용).
 */

import { Router } from 'express';
import authMiddleware from '../middleware/auth.js';
import { upsertFeedback, deleteFeedback } from '../services/feedbackService.js';

const router = Router();

router.post('/', authMiddleware, async (req, res, next) => {
  try {
    const { place_id, rating } = req.body || {};
    const placeId = Number(place_id);
    if (!Number.isInteger(placeId) || placeId <= 0) {
      return res.status(400).json({ error: 'place_id 가 올바르지 않습니다.' });
    }
    if (rating == null) {
      return res.status(400).json({ error: 'rating 이 필요합니다.' });
    }
    const row = await upsertFeedback(req.userId, placeId, rating);
    res.json({ ok: true, feedback: row });
  } catch (err) {
    next(err);
  }
});

router.delete('/:place_id', authMiddleware, async (req, res, next) => {
  try {
    const placeId = Number(req.params.place_id);
    if (!Number.isInteger(placeId) || placeId <= 0) {
      return res.status(400).json({ error: 'place_id 가 올바르지 않습니다.' });
    }
    await deleteFeedback(req.userId, placeId);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
