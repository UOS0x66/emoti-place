const openai = require('../config/openai');
const PERSONAS = require('../prompts/personas');
const { getSession, updateSession } = require('./sessionService');

const MAX_HISTORY = 20;
const LLM_MODEL = process.env.LLM_MODEL || 'gpt-4o';

/**
 * 페르소나 대화 응답을 SSE 스트리밍으로 생성한다.
 * @param {string} sessionId
 * @param {string} userMessage
 * @param {object} res - Express response (SSE용)
 */
async function streamChat(sessionId, userMessage, res) {
  const session = await getSession(sessionId);
  const persona = PERSONAS[session.persona_id];

  // 대화 히스토리 로드
  let history = session.conversation_history || [];

  // 사용자 메시지 추가
  history.push({ role: 'user', content: userMessage });

  // LLM 호출 메시지 구성
  const messages = [
    { role: 'system', content: persona.system_prompt },
    ...history.slice(-MAX_HISTORY),
  ];

  // SSE 헤더 설정
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  let fullResponse = '';

  try {
    const stream = await openai.chat.completions.create({
      model: LLM_MODEL,
      messages,
      stream: true,
      temperature: 0.8,
      max_tokens: 1024,
    });

    for await (const chunk of stream) {
      const token = chunk.choices[0]?.delta?.content || '';
      if (token) {
        fullResponse += token;
        res.write(`data: ${JSON.stringify({ token })}\n\n`);
      }
    }

    // 히스토리에 응답 추가 후 저장
    history.push({ role: 'assistant', content: fullResponse });

    // 히스토리 크기 제한
    if (history.length > MAX_HISTORY) {
      history = history.slice(-MAX_HISTORY);
    }

    await updateSession(sessionId, {
      conversation_history: history,
    });

    res.write(`data: ${JSON.stringify({ done: true, full_response: fullResponse })}\n\n`);
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
  } finally {
    res.end();
  }
}

module.exports = { streamChat };
