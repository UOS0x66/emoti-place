const { Router } = require('express');
const authMiddleware = require('../middleware/auth');
const { recommend } = require('../services/recommendService');

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

module.exports = router;
