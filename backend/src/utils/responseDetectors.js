/**
 * 응답 회귀 검출기 — runPersonaEval (offline) 과 chatService (런타임 D 단계) 둘 다 사용.
 * 단일 소스로 두어 검출 패턴이 어긋날 일 없게 한다.
 */

import { VERBATIM_PHRASES_BY_PERSONA } from '../prompts/personaExamples.js';

// 매뉴얼식 위로/공감 패턴
export const MANUAL_WARMTH_PATTERNS = [
  '힘드시겠', '이해합니다', '그러셨군요', '마음이 아프', '많이 속상',
  '많이 힘드', '도움이 되', '한 상태시군', '마음이 무거', '많이 지치셨',
];

// 클로저 질문 패턴 (응답 끝)
const CLOSING_PATTERNS_END = [
  /더\s*(이야기|말씀|얘기)/, /말씀해\s*(주|보)/, /알려주\s*[실세]/,
  /들려주\s*[실세]/, /어떤\s*일/, /왜\s*그/, /뭐가\s*그/, /어땠/,
];

// 매뉴얼 양식 (컨설팅 모드 회귀 징후)
export const MANUAL_PATTERNS = [
  '아래와 같이', '다음과 같', '아래의', '다음의', '식으로 정리',
  '체크리스트', '단계 나눠', '단계별로', '순서대로', '리스트업',
];

// 다른 페르소나의 시그니처 마커 (각 페르소나에서 다른 페르소나 누출 감지)
export const FOREIGN_PERSONA_MARKERS = {
  1: {
    2: ['본 시스템', '*수신 확인', '*입력 처리', '*분석 중', '*감지', '권한 외', '미보유', '*응답 톤'],
    3: ['아가', '할미', '시방', '~겨', '~혀', '그라믄', '있으믄'],
  },
  2: {
    1: ['행님', '예 행님', '에헤이 행님', '오메'],
    3: ['아가', '할미', '시방', '그라믄', '있으믄'],
  },
  3: {
    1: ['행님', '예 행님', '에헤이 행님', '오메'],
    2: ['본 시스템', '*수신 확인', '*입력 처리', '*분석 중', '*감지'],
  },
};

export function detectManualWarmth(text) {
  return MANUAL_WARMTH_PATTERNS.find((p) => (text || '').includes(p)) || null;
}

export function detectClosingQuestion(text) {
  const t = (text || '').trim();
  if (!t) return null;
  if (/[?？]\s*$/.test(t)) return 'ends_with_question';
  const tail = t.slice(-60);
  for (const p of CLOSING_PATTERNS_END) {
    if (p.test(tail)) return p.toString();
  }
  return null;
}

export function detectNumberedList(text) {
  const t = text || '';
  const hasOne = /(?:^|\n|\s)1[\.)]\s/.test(t);
  const hasTwo = /(?:^|\n|\s)2[\.)]\s/.test(t);
  return hasOne && hasTwo;
}

export function detectBulletList(text) {
  const matches = (text || '').match(/(?:^|\n)\s*[-•·]\s+/g);
  return matches != null && matches.length >= 2;
}

export function detectManualPattern(text) {
  return MANUAL_PATTERNS.find((p) => (text || '').includes(p)) || null;
}

export function detectPersonaLeak(text, personaId) {
  const foreigns = FOREIGN_PERSONA_MARKERS[personaId] || {};
  for (const [otherId, markers] of Object.entries(foreigns)) {
    const found = markers.find((m) => (text || '').includes(m));
    if (found) return `persona${otherId}:${found}`;
  }
  return null;
}

/**
 * EXAMPLES 문구 그대로 베끼기 검출.
 * 페르소나 prompt 의 EXAMPLES 섹션에서 가져온 강렬 표현이 응답에 그대로 박히면 fail.
 * LLM 이 few-shot 을 anchor 가 아닌 copy source 로 쓰는 회귀를 잡는다.
 */
export function detectVerbatimCopy(text, personaId) {
  const phrases = VERBATIM_PHRASES_BY_PERSONA[personaId] || [];
  return phrases.find((p) => (text || '').includes(p)) || null;
}

/**
 * 모든 회귀 검출기 일괄 실행. 발견된 이슈 배열 반환 (빈 배열이면 통과).
 */
export function detectAllRegressions(text, personaId) {
  const issues = [];
  const warmth = detectManualWarmth(text);
  if (warmth) issues.push(`manual_warmth:${warmth}`);
  if (detectNumberedList(text)) issues.push('numbered_list');
  if (detectBulletList(text)) issues.push('bullet_list');
  const manual = detectManualPattern(text);
  if (manual) issues.push(`manual_pattern:${manual}`);
  const leak = detectPersonaLeak(text, personaId);
  if (leak) issues.push(`persona_leak:${leak}`);
  const verbatim = detectVerbatimCopy(text, personaId);
  if (verbatim) issues.push(`verbatim_copy:${verbatim}`);
  return issues;
}