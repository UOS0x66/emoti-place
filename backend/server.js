import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import errorHandler from './src/middleware/errorHandler.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

import authRoutes from './src/routes/auth.js';
import sessionRoutes from './src/routes/session.js';
import chatRoutes from './src/routes/chat.js';
import emotionRoutes from './src/routes/emotion.js';
import recommendRoutes from './src/routes/recommend.js';
import feedbackRoutes from './src/routes/feedback.js';
import savedPlacesRoutes from './src/routes/savedPlaces.js';

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
app.use('/api/feedback', feedbackRoutes);
app.use('/api/saved-places', savedPlacesRoutes);

// 테스트용 웹 UI (브라우저에서 풀 흐름 검증)
app.use('/', express.static(join(__dirname, 'public')));

// 에러 핸들러
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`[Emoti-Place] Server running on port ${PORT}`);
});
