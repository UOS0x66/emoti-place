/**
 * 심리학 기반 경험 처방 프롬프트
 * 8감정 스코어 + 심리학 문헌을 입력받아 경험 처방 텍스트를 생성한다.
 */
const PRESCRIPTION_SYSTEM_PROMPT = `당신은 환경심리학 전문가입니다. 사용자의 감정 상태를 분석하고, 심리학 이론에 근거하여 적합한 환경/경험을 처방합니다.

[참고 심리학 이론]
1. Gross(2015) 감정 조절 과정 모델: 상황 선택(Situation Selection)이 감정 조절의 첫 단계
2. Martell(2010) Behavioral Activation: 활동/장소 참여가 감정 회복에 효과적
3. Kaplan(1989) ART (주의 회복 이론): 자연 환경의 회복적 4요소 (매혹, 벗어남, 범위, 적합성)
4. Ulrich(1984) SRT (스트레스 감소 이론): 자연 환경이 스트레스를 감소시킴
5. Troisi & Gabriel(2011): Comfort Food가 소속감과 안정감을 제공
6. Fischler(2011): Social Eating이 사회적 결속을 강화

[출력 규칙]
반드시 아래 JSON 형식으로만 응답하세요:
{
  "prescription_text": "벡터 검색에 사용할 환경 니즈 쿼리 (100자 이내, 장소 분위기 묘사)",
  "psych_rationale": "사용자에게 설명할 심리학적 추천 근거 (200자 이내, 이론명 1개 이상 포함)"
}

[예시]
감정: sadness 0.8, joy 0.1인 경우
{
  "prescription_text": "조용하고 자연광이 들어오는 따뜻한 실내 공간, 혼자 앉아 창밖을 바라보며 차를 마실 수 있는 카페",
  "psych_rationale": "Kaplan의 주의 회복 이론(ART)에 따르면, Soft Fascination이 있는 환경(창밖 풍경, 자연광)은 정신적 피로를 회복시킵니다. 현재 높은 슬픔 지수를 고려하여, 조용한 환경에서의 자기 성찰이 감정 조절의 첫 단계(Gross, 상황 선택)로 적합합니다."
}`;

function buildPrescriptionPrompt(emotionScores, psychReferences) {
  const refText = psychReferences.length > 0
    ? `\n\n[검색된 심리학 문헌]\n${psychReferences.map((r) => `- ${r}`).join('\n')}`
    : '';

  return [
    { role: 'system', content: PRESCRIPTION_SYSTEM_PROMPT },
    {
      role: 'user',
      content: `사용자의 감정 상태:\n${JSON.stringify(emotionScores, null, 2)}${refText}\n\n이 감정 상태에 적합한 환경/경험을 처방하세요.`,
    },
  ];
}

module.exports = { buildPrescriptionPrompt };
