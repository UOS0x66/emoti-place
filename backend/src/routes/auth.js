import { Router } from 'express';
import { signup, login, updateMbti } from '../services/authService.js';
import authMiddleware from '../middleware/auth.js';

const router = Router();

// POST /api/auth/signup
router.post('/signup', async (req, res, next) => {
  try {
    const { email, nickname, password, mbti } = req.body;

    if (!email || !nickname || !password) {
      return res.status(400).json({ error: '이메일, 닉네임, 비밀번호를 모두 입력해주세요.' });
    }

    const result = await signup(email, nickname, password, mbti);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/login
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: '이메일과 비밀번호를 입력해주세요.' });
    }

    const result = await login(email, password);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/auth/mbti  — 로그인 사용자의 MBTI 변경 (null 허용 = 해제)
router.patch('/mbti', authMiddleware, async (req, res, next) => {
  try {
    const { mbti } = req.body;
    const result = await updateMbti(req.userId, mbti ?? null);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
