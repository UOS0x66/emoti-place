const { Router } = require('express');
const { signup, login } = require('../services/authService');

const router = Router();

// POST /api/auth/signup
router.post('/signup', async (req, res, next) => {
  try {
    const { email, nickname, password } = req.body;

    if (!email || !nickname || !password) {
      return res.status(400).json({ error: '이메일, 닉네임, 비밀번호를 모두 입력해주세요.' });
    }

    const result = await signup(email, nickname, password);
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

module.exports = router;
