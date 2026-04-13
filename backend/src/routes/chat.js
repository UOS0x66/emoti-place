const { Router } = require('express');
const authMiddleware = require('../middleware/auth');
const { streamChat } = require('../services/chatService');

const router = Router();

// POST /api/chat/message - 채팅 메시지 전송 (SSE 스트리밍 응답)
router.post('/message', authMiddleware, async (req, res, next) => {
  try {
    const { session_id, message } = req.body;

    if (!session_id || !message) {
      return res.status(400).json({ error: 'session_id와 message를 입력해주세요.' });
    }

    await streamChat(session_id, message, res);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
