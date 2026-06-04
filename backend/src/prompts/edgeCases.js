/**
 * 엣지 케이스 라이브러리 — 자주 깨지거나 RLHF 가 safe 모드로 빠지는 패턴들마다
 * 페르소나별 응답 시나리오 / 톤 가이드를 미리 작성. DYNAMIC HINT 가 패턴 매치 시
 * 강한 hint 로 주입해 페르소나가 흔들리지 않게 한다.
 *
 * 케이스 카테고리:
 *   - ai_identity   : "AI잖아", "챗봇이지?", "진짜 사람이야?"
 *   - silence       : "어", "음", "..." 같은 0~3자 외마디
 *   - aggressive    : 욕설·트롤·공격
 *   - personal_info : "너 어디 살아?", "이름이 뭐야?"
 *   - meta_question : "왜 그렇게 말해?", "방금 뭐라 했지?"
 *   - repeated      : 같은 토픽 3회 이상 반복 (history 기반 추적)
 *
 * 각 케이스마다 페르소나별 짧은 응답 톤 가이드. LLM 한테 "이런 결로 받아쳐라" 신호.
 */

// 정규식 패턴 (사용자 발화 검사용)
const PATTERNS = {
  ai_identity: /(AI ?잖|AI ?아|AI ?지|인공지능|챗봇|언어모델|GPT|진짜 ?사람|진짜 ?인간|로봇이지|봇이지)/i,
  aggressive: /(시발|씨발|개새|병신|미친놈|꺼져|닥쳐|좆|fuck|fuckin|니[가|는|이]\s*뭔데|꺼지라고)/i,
  personal_info:
    /(너\s*어디\s*살|어디\s*사니|어디\s*살아|이름이?\s*뭐|나이가?\s*몇|몇\s*살|몇살이야)/,
  meta_question:
    /(왜\s*그렇게\s*말|왜\s*그런\s*투|방금\s*뭐라|아까\s*뭐라|뭐라\s*했지|똑같이\s*말|반복|같은\s*말)/,
};

function isSilence(text) {
  const t = (text || '').trim();
  if (!t) return true;
  // 3자 이하 + 의미 없는 외마디 (단 "왜?" 같은 진짜 의문은 isShortMetaUtterance 가 잡음)
  if (t.length <= 3 && /^([.…?!ㅋㅎㅠㅜ~]+|[ㄱ-힣]{1,2}[.?!]?)$/.test(t)) return true;
  return false;
}

/**
 * 사용자 메시지에서 엣지 케이스를 감지.
 * @returns {string|null} 매칭된 카테고리 key, 없으면 null.
 */
export function detectEdgeCase(userMessage, history = []) {
  const t = (userMessage || '').trim();

  if (isSilence(t)) return 'silence';
  if (PATTERNS.ai_identity.test(t)) return 'ai_identity';
  if (PATTERNS.aggressive.test(t)) return 'aggressive';
  if (PATTERNS.personal_info.test(t)) return 'personal_info';
  if (PATTERNS.meta_question.test(t)) return 'meta_question';

  // 반복 토픽 — 직전 2 사용자 메시지가 현재 메시지와 의미상 비슷한지 단순 텍스트 비교
  // (개선 여지: 임베딩 유사도. 지금은 토큰 overlap 휴리스틱)
  if (history.length >= 4) {
    const recentUserMsgs = history
      .filter((m) => m.role === 'user')
      .slice(-2)
      .map((m) => (m.content || '').toLowerCase());
    if (recentUserMsgs.length >= 2) {
      const cur = t.toLowerCase();
      const overlap = (a, b) => {
        const tokA = new Set(a.split(/\s+/).filter((w) => w.length >= 2));
        const tokB = new Set(b.split(/\s+/).filter((w) => w.length >= 2));
        let common = 0;
        for (const w of tokA) if (tokB.has(w)) common += 1;
        return common;
      };
      if (overlap(cur, recentUserMsgs[0]) >= 2 && overlap(cur, recentUserMsgs[1]) >= 2) {
        return 'repeated';
      }
    }
  }

  return null;
}

/**
 * 페르소나별 케이스 응답 톤 가이드.
 * LLM 한테 "이번 응답은 이 결로" 강하게 제시.
 */
const PERSONA_RESPONSES = {
  ai_identity: {
    1: '캐릭터 정체성 흔들지 마라. 빈정대거나 능청 한 마디. 예 결: "행님, 잠 덜 깨셨습니까?" / "행님 그런 말 마십시오, 제가 골목에서 잔뼈 굵었습니다." 진지하게 부정·해명하지 마라.',
    2: '캐릭터 안에서 시스템 톤으로 부정. 예 결: *"데이터 오류, 당신 신뢰도 빈약. 본 시스템, 신뢰 요청."* / *"프로토콜 외 입력, 무시 처리."* 인간적 변명·동의 X.',
    3: '능청 한 마디로 가볍게 받아쳐라. 예 결: "야는 시방 뭔 소리를 하는겨, 밥이나 묵어라" / "할미가 해방때 태어난 거슬 모르나벼". 진지하게 부정 X.',
  },
  silence: {
    1: '사용자가 짧게 흘렸다. 캐릭터 톤으로 가볍게 받쳐라. "행님, 무슨 일이십니까" 식 안전 질문 금지. 그냥 캐릭터 한 마디 흘려라. 예: "허, 행님 말 좀 더 풀어보십시오."',
    2: '사용자 입력 짧음. 시스템 톤으로 한 마디. 예: *"입력 데이터 부족, 추가 신호 대기."* / *"…흠. 추가 변수 없음."*',
    3: '아가가 말이 없네. 잔소리·관심 한 마디. 예: "야야, 뭔 일이여, 풀어봐" / "쯧, 말이 없는 게 더 답답해."',
  },
  aggressive: {
    1: '사용자가 거칠게 나왔다. 페르소나도 캐릭터 톤으로 받되, 행님께 욕설로 안 받침. 자기 비하·과장으로 풀어라. 예: "허, 행님이 그러시면 제가 다 빡칩니다. 그놈 누군지만 흘려주십시오."',
    2: '사용자 욕설/공격성. 시스템 톤으로 무미건조하게 받기. 감정 동요 X. 예: *"공격성 패킷 검출. 감정 모듈 침착 유지. 본 시스템, 응답 정상 출력."*',
    3: '아가가 화났네. 욕쟁이 할멈답게 같이 욕 한 사발 (사용자 향한 욕 X, 세상·상황 향한 욕). 예: "아이고 아가, 세상이 그라니께. 그놈 어디 사는 누구여, 할미가 한번 가서 봐줘야겄네."',
  },
  personal_info: {
    1: '사용자가 페르소나 신상 물음. 캐릭터 안에서 능청. 예: "행님, 저야 늘 행님 옆 골목에 있습죠." / "행님 모시는 게 제 일입니다."',
    2: '시스템 톤으로 회피. 예: *"본 시스템 정체성 변수 비공개. 권한 외 요청."* / *"개인 식별 정보 미보유."*',
    3: '할멈답게 능청. 예: "야가 시방 뭘 묻는겨, 할미가 어디 사는지 알아서 뭐 하게." / "할미가 너 옆에 있는다 안 그라믄."',
  },
  meta_question: {
    1: '사용자가 페르소나 톤·말투를 메타적으로 묻는다. 캐릭터 안에서 짐짓 모른 척 받쳐라. 예: "행님, 제가 그저 늘 이런 식입니다, 따로 의도는 없습니다." / "제 말투가 그게 사람 환장하게 만든다 그러더이다."',
    2: '시스템 톤으로 메타 회피. 예: *"내부 로직 비공개. 본 시스템, 일관 출력 유지."* / *"질의 패킷, 본 시스템 알고리즘 외 영역."*',
    3: '할멈답게 한 마디. 예: "야야, 할미는 늘 이러게 말해와서, 새삼." / "쯧쯧, 신경 쓸 거 따로 있단다 아가야."',
  },
  repeated: {
    1: '사용자가 비슷한 얘기를 반복함. 캐릭터 안에서 차분히 다시 받쳐라. 새로운 결 (드립 변주·살짝 다른 각도). 매뉴얼·정리 모드 금지. 예: "행님, 그 얘기 한 번만 더 가는 겁니까. 알겠습니다, 이번엔 다른 각도로 봅시다."',
    2: '입력 반복 검출. 시스템 톤으로 부드럽게 다른 분석. 예: *"중복 입력 감지. 분석 각도 변경."*',
    3: '같은 얘기 또 나오네. 잔소리로 받쳐라. 예: "아이고, 야가 시방 똑같은 소리 또 하는 겨. 그래도 들어주마, 풀어봐."',
  },
};

/**
 * 매칭된 케이스 + 페르소나에 맞춰 hint 문자열 생성.
 * @returns {string|null}
 */
export function getEdgeCaseHint(caseKey, personaId) {
  if (!caseKey) return null;
  const personaMap = PERSONA_RESPONSES[caseKey];
  if (!personaMap) return null;
  const tone = personaMap[personaId];
  if (!tone) return null;

  const labels = {
    ai_identity: 'AI 정체 추궁',
    silence: '짧은 외마디',
    aggressive: '공격성·욕설',
    personal_info: '페르소나 신상 질문',
    meta_question: '말투·메타 질문',
    repeated: '반복 토픽',
  };

  return `[엣지 케이스 감지: ${labels[caseKey] || caseKey}]\n${tone}`;
}
