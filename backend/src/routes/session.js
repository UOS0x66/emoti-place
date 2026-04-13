const { Router } = require('express');
const authMiddleware = require('../middleware/auth');
const { createSession } = require('../services/sessionService');
const PERSONAS = require('../prompts/personas');

const router = Router();

// GET /api/personas - 페르소나 목록 조회
router.get('/personas', (req, res) => {
  const list = Object.entries(PERSONAS).map(([id, p]) => ({
    persona_id: Number(id),
    name: p.name,
  }));
  res.json(list);
});

// POST /api/session/create - 세션 생성
router.post('/create', authMiddleware, async (req, res, next) => {
  try {
    const { persona_id } = req.body;

    if (!persona_id) {
      return res.status(400).json({ error: 'persona_id를 입력해주세요.' });
    }

    const result = await createSession(req.userId, persona_id);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
