/**
 * @deprecated - 이 파일은 하위 호환 wrapper입니다.
 * 신규 코드는 `./envNeed.js`의 `buildEnvNeedPrompt`를 직접 사용하세요.
 *
 * 설계서 리팩터링 (2026-04): 기존 prescription 역할이 envNeed 모듈로 이관되었습니다.
 * 출력 스키마가 변경되었습니다:
 *   - (이전) { prescription_text, psych_rationale }
 *   - (이후) { environment_query, psych_rationale, applied_theories }
 */

const { buildEnvNeedPrompt } = require('./envNeed');

function buildPrescriptionPrompt(emotionScores, psychReferences) {
  return buildEnvNeedPrompt(emotionScores, psychReferences);
}

module.exports = { buildPrescriptionPrompt };
