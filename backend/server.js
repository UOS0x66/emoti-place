require('dotenv').config();

const express = require('express');
const cors = require('cors');
const errorHandler = require('./src/middleware/errorHandler');

const authRoutes = require('./src/routes/auth');
const sessionRoutes = require('./src/routes/session');
const chatRoutes = require('./src/routes/chat');
const emotionRoutes = require('./src/routes/emotion');
const recommendRoutes = require('./src/routes/recommend');

const app = express();
const PORT = process.env.PORT || 3000;

// 미들웨어
app.use(cors());
app.use(express.json());

// 헬스체크
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// 라우트
app.use('/api/auth', authRoutes);
app.use('/api/session', sessionRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/emotion', emotionRoutes);
app.use('/api/recommend', recommendRoutes);

// 에러 핸들러
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`[Emoti-Place] Server running on port ${PORT}`);
});
