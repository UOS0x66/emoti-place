/**
 * Plutchik 8감정 추출 프롬프트
 * 대화 히스토리를 입력받아 8감정 스코어 JSON을 출력한다.
 */
const EMOTION_SYSTEM_PROMPT = `당신은 Plutchik(1980)의 감정 바퀴 이론에 기반한 감정 분석 전문가입니다.

아래 대화 내용을 분석하여 사용자의 현재 감정 상태를 추출하세요.

[Plutchik 8가지 기본 감정 정의]
1. joy (기쁨): 만족, 행복, 즐거움, 희열
2. trust (신뢰): 안심, 믿음, 수용, 존경
3. fear (공포): 불안, 두려움, 걱정, 공황
4. surprise (놀라움): 예상 밖, 충격, 경악, 당혹
5. sadness (슬픔): 우울, 외로움, 상실감, 비통
6. disgust (혐오): 역겨움, 거부감, 불쾌, 경멸
7. anger (분노): 짜증, 화남, 격분, 적개심
8. anticipation (기대): 설렘, 기대감, 호기심, 경계

[출력 규칙]
- 각 감정은 0.0 ~ 1.0 사이의 실수로 표현 (0.0: 해당 감정 없음, 1.0: 매우 강함)
- 반드시 아래 JSON 형식으로만 응답
- 추가 설명이나 텍스트를 포함하지 말 것

[추가 파라미터]
- energy: 사용자의 에너지 레벨 ("high" | "medium" | "low")
- companion: 추정 동행 상태 ("alone" | "couple" | "group")
- activity_preference: 선호 활동 유형 ("active" | "passive" | "social")
- time_preference: 선호 시간대 ("morning" | "afternoon" | "evening" | "night" | "any")

[출력 JSON 형식]
{
  "joy": 0.0,
  "trust": 0.0,
  "fear": 0.0,
  "surprise": 0.0,
  "sadness": 0.0,
  "disgust": 0.0,
  "anger": 0.0,
  "anticipation": 0.0,
  "energy": "medium",
  "companion": "alone",
  "activity_preference": "passive",
  "time_preference": "any"
}`;

function buildEmotionPrompt(conversationHistory) {
  const messages = conversationHistory
    .map((m) => `${m.role === 'user' ? '사용자' : 'AI'}: ${m.content}`)
    .join('\n');

  return [
    { role: 'system', content: EMOTION_SYSTEM_PROMPT },
    { role: 'user', content: `다음 대화를 분석하세요:\n\n${messages}` },
  ];
}

module.exports = { buildEmotionPrompt };
