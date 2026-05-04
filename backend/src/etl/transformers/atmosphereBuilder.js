/**
 * atmosphere_text 빌더 (transformer 레이어)
 *
 * TourAPI 원본을 임베딩용 자연어로 가공.
 * 의미축만(정체성/분위기/맥락/시그니처) — 운영정보는 placeMapper로 분리.
 */

/**
 * cat3 → {activities, mood, context} 어휘 풀.
 * atmosphere_text 마지막에 한 줄로 합성 — 사용자 쿼리의 추상 어휘
 * (감정/동행/활동)와의 매칭 키워드 갭을 메우기 위한 보수적 보강.
 *
 * 환각 방지 원칙: 카테고리 평균 특성만 사용. 개별 장소가 다를 수도 있음을
 * 감안해 강한 형용사("매우", "최고")는 배제하고 "보통/주로" 톤으로 작성.
 */
const CAT3_KEYWORDS = {
  // 음식점 (39)
  A05020100: { activities: ['식사', '한식'],            mood: ['담백한', '정겨운'],        context: ['가족', '혼밥', '회식'] },
  A05020200: { activities: ['식사', '양식'],            mood: ['세련된', '캐주얼한'],      context: ['데이트', '모임'] },
  A05020300: { activities: ['식사', '일식'],            mood: ['정갈한', '깔끔한'],        context: ['데이트', '혼밥'] },
  A05020400: { activities: ['식사', '중식'],            mood: ['푸짐한', '얼큰한'],        context: ['가족', '회식'] },
  A05020500: { activities: ['식사', '아시아식'],        mood: ['이국적인'],                context: ['친구', '데이트'] },
  A05020600: { activities: ['식사'],                    mood: ['편안한'],                  context: ['가족', '아이 동반'] },
  A05020700: { activities: ['식사', '특별한 경험'],     mood: ['이색적인'],                context: ['친구', '데이트'] },
  A05020900: { activities: ['커피', '차', '대화', '독서', '작업'], mood: ['아늑한', '여유로운'], context: ['혼자', '데이트', '친구'] },
  A05021000: { activities: ['술', '음주'],              mood: ['활기찬'],                  context: ['친구', '회식'] },
  // 자연 (12)
  A01010400: { activities: ['등산', '산책', '하이킹'],  mood: ['상쾌한', '평온한'],        context: ['혼자', '가족', '운동'] },
  A01010500: { activities: ['관찰', '산책'],            mood: ['자연 친화적', '평화로운'], context: ['가족', '교육'] },
  A01011600: { activities: ['산책', '경치 감상'],       mood: ['평화로운'],                context: ['데이트', '가족'] },
  A01011700: { activities: ['산책', '경치 감상'],       mood: ['시원한', '탁 트인'],       context: ['데이트', '가족'] },
  // 역사·전통 (12)
  A02010100: { activities: ['관람', '역사 탐방'],       mood: ['고즈넉한', '전통적'],      context: ['데이트', '가족', '교육'] },
  A02010600: { activities: ['구경', '산책'],            mood: ['전통적', '아기자기한'],    context: ['데이트', '가족'] },
  A02010700: { activities: ['관람', '역사 탐방'],       mood: ['고즈넉한'],                context: ['교육', '가족'] },
  A02010800: { activities: ['참배', '명상', '산책'],    mood: ['고요한', '경건한'],        context: ['혼자', '가족'] },
  // 문화시설 (14)
  A02020200: { activities: ['관람', '학습'],            mood: ['차분한', '교육적'],        context: ['가족', '아이 동반', '데이트'] },
  A02020300: { activities: ['관람', '추모'],            mood: ['엄숙한', '차분한'],        context: ['교육', '가족'] },
  A02020400: { activities: ['관람'],                    mood: ['차분한'],                  context: ['데이트', '가족'] },
  A02020600: { activities: ['전시 관람', '예술 감상'],  mood: ['감성적인', '차분한'],      context: ['데이트', '혼자'] },
  A02020700: { activities: ['공연 관람'],               mood: ['예술적', '감성적인'],      context: ['데이트', '친구'] },
  A02020800: { activities: ['문화 체험'],               mood: ['따뜻한'],                  context: ['가족', '교육'] },
  A02021000: { activities: ['독서', '공부', '작업', '책 읽기'], mood: ['조용한', '차분한', '사색하기 좋은'], context: ['혼자', '학습'] },
  A02021100: { activities: ['책 구경', '독서'],         mood: ['조용한'],                  context: ['혼자', '데이트'] },
  A02021300: { activities: ['영화 관람'],               mood: ['엔터테인먼트'],            context: ['데이트', '친구', '가족'] },
  // 휴양·체험
  A02030100: { activities: ['놀이', '체험'],            mood: ['활기찬', '신나는'],        context: ['가족', '아이', '친구'] },
  A02030200: { activities: ['관광', '체험'],            mood: ['특색있는'],                context: ['가족', '친구'] },
  A02030300: { activities: ['휴식', '온천', '목욕'],    mood: ['편안한', '치유의'],        context: ['혼자', '커플', '가족'] },
  A02030600: { activities: ['동물 관람', '체험'],       mood: ['활기찬'],                  context: ['가족', '아이'] },
  A02030700: { activities: ['관람', '산책'],            mood: ['평화로운', '자연'],        context: ['데이트', '가족'] },
  A02030800: { activities: ['관람'],                    mood: ['신비로운'],                context: ['가족', '아이', '데이트'] },
  A02080100: { activities: ['관광', '구경'],            mood: ['특색있는'],                context: ['가족', '친구'] },
};

const TYPE_FALLBACK_KEYWORDS = {
  '12': { activities: ['관광', '구경'],          mood: ['특색있는'],   context: ['가족', '친구'] },
  '14': { activities: ['관람', '문화 체험'],     mood: ['차분한'],     context: ['가족', '데이트'] },
  '28': { activities: ['레저', '활동', '운동'],  mood: ['활기찬'],     context: ['친구', '가족'] },
  '39': { activities: ['식사'],                  mood: ['편안한'],     context: ['가족', '친구'] },
};

const CAT3_LABEL = {
  // 음식점 (39)
  A05020100: '한식', A05020200: '서양식', A05020300: '일식', A05020400: '중식',
  A05020500: '아시아식', A05020600: '패밀리레스토랑', A05020700: '이색음식점',
  A05020900: '카페/전통찻집', A05021000: '클럽',
  // 관광지 (12) — 자연
  A01010100: '국립공원', A01010200: '도립공원', A01010300: '군립공원',
  A01010400: '산', A01010500: '자연생태관광지', A01010600: '자연휴양림',
  A01010700: '수목원', A01010800: '폭포', A01010900: '계곡',
  A01011200: '해수욕장', A01011600: '호수', A01011700: '강',
  // 관광지 — 역사/문화
  A02010100: '고궁', A02010200: '성', A02010300: '문', A02010400: '고택',
  A02010500: '생가', A02010600: '민속마을', A02010700: '유적지/사적지',
  A02010800: '사찰', A02010900: '종교성지',
  // 문화시설 (14)
  A02020200: '박물관', A02020300: '기념관', A02020400: '전시관',
  A02020500: '컨벤션센터', A02020600: '미술관/화랑', A02020700: '공연장',
  A02020800: '문화원', A02021000: '도서관', A02021100: '대형서점', A02021300: '영화관',
  // 휴양/체험
  A02030100: '유원지', A02030200: '관광단지', A02030300: '온천/욕장/스파',
  A02030600: '동물원', A02030700: '식물원', A02030800: '수족관',
  A02080100: '관광지',
};

function stripHtml(s) {
  if (!s) return '';
  return String(s)
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * atmosphere_text → 사용자 노출용 짧은 요약 (summary_text).
 *
 * 휴리스틱:
 *  1) overview가 있으면 첫 문장(또는 두 문장)을 우선 사용 — 가장 정보 밀도가 높은 부분.
 *  2) overview가 없을 때만 atmosphere_text 첫 의미 문장 사용 (헤더 문장은 건너뜀).
 *  3) 결과를 최대 140자에서 컷, 너무 길면 마지막 문장 경계에서 컷 + 말줄임.
 */
function buildSummaryText({ overview, atmosphereText, fallbackTitle }) {
  const cleanedOverview = stripHtml(overview || '').trim();
  const SENTENCE_SPLIT = /(?<=[.!?。])\s+/;
  const HEADER_REGEX = /^[\s\S]{0,40}'([^']+)'\.\s*/;

  const pickFirstSentences = (text, count = 1) => {
    if (!text) return '';
    const sentences = text
      .split(SENTENCE_SPLIT)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    return sentences.slice(0, count).join(' ');
  };

  let candidate = '';
  if (cleanedOverview) {
    candidate = pickFirstSentences(cleanedOverview, 2);
  }

  if (!candidate && atmosphereText) {
    const stripped = atmosphereText.replace(HEADER_REGEX, '').trim();
    candidate = pickFirstSentences(stripped, 2);
  }

  if (!candidate) {
    return fallbackTitle ? `${fallbackTitle}.` : '';
  }

  candidate = candidate.replace(/\s+/g, ' ').trim();

  const HARD_CAP = 140;
  if (candidate.length > HARD_CAP) {
    const truncated = candidate.slice(0, HARD_CAP);
    const lastEnd = Math.max(
      truncated.lastIndexOf('. '),
      truncated.lastIndexOf('? '),
      truncated.lastIndexOf('! ')
    );
    candidate = (lastEnd > 60 ? truncated.slice(0, lastEnd + 1) : truncated).trim() + '…';
  }

  return candidate;
}

function extractDistrict(addr1) {
  if (!addr1) return null;
  const guMatch = String(addr1).match(/서울특별시\s+([가-힣]+구)/);
  if (!guMatch) return null;
  const dongMatch = String(addr1).match(/([가-힣]{1,5}동)(?![가-힣])/);
  return { gu: guMatch[1], dong: dongMatch ? dongMatch[1] : null };
}

function buildAtmosphereText(record) {
  const list = record.list || {};
  const common = record.common || {};
  const intro = record.intro || {};

  const title = list.title || common.title || '(제목없음)';
  const overview = stripHtml(common.overview);
  const cat3 = common.cat3 || list.cat3 || '';
  const cat3Label = CAT3_LABEL[cat3] || '';
  const district = extractDistrict(list.addr1 || common.addr1);

  const parts = [];

  const locStr = district
    ? (district.dong ? `${district.gu} ${district.dong}` : district.gu)
    : '';
  const idHeader = [locStr, cat3Label].filter(Boolean).join(' ');
  parts.push(idHeader ? `${idHeader} '${title}'.` : `'${title}'.`);

  if (overview) parts.push(overview);

  const sigBits = [];
  if (intro.firstmenu) sigBits.push(`대표 메뉴는 ${intro.firstmenu}`);
  if (intro.treatmenu && intro.treatmenu !== intro.firstmenu) {
    sigBits.push(`주요 메뉴로 ${intro.treatmenu}`);
  }
  if (sigBits.length > 0) parts.push(sigBits.join(', ') + '.');

  const ctxBits = [];
  if (intro.scalefood) ctxBits.push(`규모는 ${intro.scalefood}`);
  if (intro.seat) ctxBits.push(`좌석 ${intro.seat}`);
  if (intro.kidsfacility === '1') ctxBits.push('아이 동반 가능');
  if (intro.expagerange) ctxBits.push(`체험 연령대 ${intro.expagerange}`);
  if (intro.expguide) {
    const eg = stripHtml(intro.expguide);
    if (eg && eg.length <= 80) ctxBits.push(eg);
  }
  if (ctxBits.length > 0) parts.push(ctxBits.join(', ') + '.');

  // 5) 카테고리 어휘 보강 — 사용자 쿼리의 추상 어휘 매칭용 (보수적)
  const kw = CAT3_KEYWORDS[cat3] || TYPE_FALLBACK_KEYWORDS[String(list.contenttypeid || common.contenttypeid || '')];
  if (kw) {
    const seg = [];
    if (kw.activities && kw.activities.length) seg.push(`주로 ${kw.activities.join('·')}하기 좋고`);
    if (kw.mood && kw.mood.length) seg.push(`${kw.mood.join('·')} 분위기로`);
    if (kw.context && kw.context.length) seg.push(`${kw.context.join('·')}에 적합하다`);
    if (seg.length > 0) parts.push(seg.join(' ') + '.');
  }

  const text = parts.join(' ').replace(/\s+/g, ' ').trim();

  let quality = 'minimal';
  if (overview.length >= 80) quality = 'rich';
  else if (overview.length > 0) quality = 'thin';

  const summary = buildSummaryText({
    overview,
    atmosphereText: text,
    fallbackTitle: title,
  });

  return {
    tour_content_id: String(list.contentid || common.contentid || ''),
    tour_content_type_id: String(list.contenttypeid || common.contenttypeid || ''),
    name: title,
    atmosphere_text: text,
    summary_text: summary,
    char_count: text.length,
    quality,
  };
}

export { buildAtmosphereText, buildSummaryText, stripHtml, CAT3_LABEL };
