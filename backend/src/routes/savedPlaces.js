/**
 * 사용자 보관함 라우트.
 *
 *   GET    /api/saved-places              -- 보관 목록
 *   POST   /api/saved-places              body: { place_id, persona_reason? }
 *   DELETE /api/saved-places/:place_id
 *
 * 모든 라우트 인증 필요.
 */

import { Router } from 'express';
import authMiddleware from '../middleware/auth.js';
import {
  savePlace,
  unsavePlace,
  listSavedPlaces,
} from '../services/savedPlaceService.js';

const router = Router();

router.get('/', authMiddleware, async (req, res, next) => {
  try {
    const places = await listSavedPlaces(req.userId);
    res.json({ places });
  } catch (err) {
    next(err);
  }
});

router.post('/', authMiddleware, async (req, res, next) => {
  try {
    const { place_id, persona_reason } = req.body || {};
    const placeId = Number(place_id);
    if (!Number.isInteger(placeId) || placeId <= 0) {
      return res.status(400).json({ error: 'place_id 가 올바르지 않습니다.' });
    }
    const row = await savePlace(req.userId, placeId, persona_reason || null);
    res.json({ ok: true, saved: row });
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
    await unsavePlace(req.userId, placeId);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
