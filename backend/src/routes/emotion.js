const { Router } = require('express');
const authMiddleware = require('../middleware/auth');
const { getEmotions } = require('../services/emotionService');

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

module.exports = router;
