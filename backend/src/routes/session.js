import { Router } from 'express';
import authMiddleware from '../middleware/auth.js';
import {
  createSession,
  listSessionsByUser,
  getSessionForUser,
  deleteSessionForUser,
  updateSessionTitleForUser,
} from '../services/sessionService.js';
import PERSONAS from '../prompts/personas.js';

const router = Router();

// GET /api/personas - 페르소나 목록 조회
router.get('/personas', (req, res) => {
  const list = Object.entries(PERSONAS).map(([id, p]) => ({
    persona_id: Number(id),
    name: p.name,
  }));
  res.json(list);
});

// GET /api/session/list - 사용자의 기존 세션 목록 조회
router.get('/list', authMiddleware, async (req, res, next) => {
  try {
    const sessions = await listSessionsByUser(req.userId);
    res.json({ sessions });
  } catch (err) {
    next(err);
  }
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

// GET /api/session/:sessionId - 세션 상세(대화 히스토리 포함)
router.get('/:sessionId', authMiddleware, async (req, res, next) => {
  try {
    const session = await getSessionForUser(req.userId, req.params.sessionId);
    res.json({
      session_id: session.session_id,
      persona_id: session.persona_id,
      title: session.title,
      conversation_history: session.conversation_history || [],
      message_count: session.message_count,
      created_at: session.created_at,
      expires_at: session.expires_at,
    });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/session/:sessionId - 세션 삭제
router.delete('/:sessionId', authMiddleware, async (req, res, next) => {
  try {
    await deleteSessionForUser(req.userId, req.params.sessionId);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/session/:sessionId - 세션 제목 수정
router.patch('/:sessionId', authMiddleware, async (req, res, next) => {
  try {
    const { title } = req.body || {};
    const updated = await updateSessionTitleForUser(
      req.userId,
      req.params.sessionId,
      title,
    );
    res.json({ ok: true, title: updated });
  } catch (err) {
    next(err);
  }
});

export default router;
