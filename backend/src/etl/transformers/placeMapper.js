/**
 * TourAPI raw 레코드 → PostgreSQL `place` 테이블 행 매퍼.
 *
 * place 스키마:
 *   place_id SERIAL — DB가 발급
 *   name VARCHAR(200)
 *   category VARCHAR(100)         — 한국어 분류 (카페/음식점/공원/...)
 *   address TEXT
 *   lat / lng DOUBLE PRECISION    — TourAPI mapy / mapx
 *   operating_hours JSONB         — { open, close, raw }
 *   photos TEXT[]
 *   atmosphere_text TEXT          — 별도 atmosphereBuilder 결과
 *   max_group_size INTEGER
 *   is_outdoor BOOLEAN
 *
 * + 멱등 적재용 추가 컬럼 (마이그레이션 필요):
 *   tour_content_id VARCHAR UNIQUE
 *   tour_content_type_id VARCHAR
 */

import { stripHtml } from './atmosphereBuilder.js';

/**
 * cat3 코드 → 한국어 카테고리.
 * 기존 seedPlaces.js 의 카테고리 어휘(카페/음식점/공원/산책로/문화공간)와 정렬.
 */
function mapCategory(cat3, contentTypeId) {
  if (!cat3) {
    if (contentTypeId === '14') return '문화공간';
    if (contentTypeId === '12') return '관광지';
    if (contentTypeId === '28') return '레포츠';
    if (contentTypeId === '39') return '음식점';
    return '기타';
  }
  if (cat3 === 'A05020900') return '카페';
  if (cat3 === 'A05021000') return '주점';
  if (cat3.startsWith('A0502')) return '음식점';
  if (cat3 === 'A01010400') return '산';
  if (cat3 === 'A01011600' || cat3 === 'A01011700') return '공원';
  if (cat3.startsWith('A0101')) return '자연';
  if (cat3.startsWith('A0201')) return '문화공간';
  if (cat3.startsWith('A0202')) return '문화시설';
  if (cat3 === 'A02080100') return '관광지';
  if (cat3.startsWith('A0203')) return '휴양시설';
  if (contentTypeId === '14') return '문화공간';
  if (contentTypeId === '12') return '관광지';
  if (contentTypeId === '28') return '레포츠';
  if (contentTypeId === '39') return '음식점';
  return '기타';
}

function isOutdoor(cat3, contentTypeId) {
  if (!cat3) return false;
  if (cat3.startsWith('A0101')) return true; // 자연
  if (cat3 === 'A02080100') return true; // 관광지
  if (cat3 === 'A02010600') return true; // 민속마을
  if (cat3 === 'A02030100') return true; // 유원지
  if (contentTypeId === '28') return true; // 레포츠 다수
  return false;
}

/**
 * "10:00~22:00" / "10:00~20:30 (라스트오더 20:00)" / "월요일~금요일 10:00~17:00"
 * 같은 다양한 입력에서 첫 두 시각을 추출.
 */
function parseHours(rawText) {
  if (!rawText) return null;
  const cleaned = stripHtml(rawText);
  const times = cleaned.match(/\d{1,2}:\d{2}/g);
  if (!times || times.length < 2) return { open: null, close: null, raw: cleaned };
  const norm = (t) => {
    const [h, m] = t.split(':');
    return `${String(h).padStart(2, '0')}:${m}`;
  };
  return { open: norm(times[0]), close: norm(times[1]), raw: cleaned };
}

function pickOperatingHours(intro, contentTypeId) {
  if (!intro) return null;
  if (contentTypeId === '39') return parseHours(intro.opentimefood);
  if (contentTypeId === '12') return parseHours(intro.usetime);
  if (contentTypeId === '14') return parseHours(intro.usetimeculture);
  if (contentTypeId === '28') return parseHours(intro.usetimeleports);
  return null;
}

/**
 * 인원 수 텍스트("100명", "약 50명")에서 정수 추출.
 */
function extractPersonCount(s) {
  if (!s) return null;
  const m = String(s).match(/(\d{1,5})\s*명/);
  return m ? Number(m[1]) : null;
}

function pickMaxGroupSize(intro, contentTypeId, isOutdoorFlag) {
  if (!intro) return isOutdoorFlag ? 30 : 10;
  if (contentTypeId === '39') {
    const seatN = extractPersonCount(intro.seat);
    const scaleN = extractPersonCount(intro.scalefood);
    return seatN || scaleN || 6;
  }
  if (contentTypeId === '12') {
    const accom = Number(intro.accomcount);
    if (Number.isFinite(accom) && accom > 0) return accom;
    return isOutdoorFlag ? 50 : 20;
  }
  if (contentTypeId === '14') {
    const scaleN = extractPersonCount(intro.scale);
    return scaleN || 30;
  }
  if (contentTypeId === '28') return 20;
  return 10;
}

function pickPhotos(list, common) {
  const out = [];
  const candidates = [
    list.firstimage, list.firstimage2,
    common && common.firstimage, common && common.firstimage2,
  ];
  for (const c of candidates) {
    if (c && !out.includes(c)) out.push(c);
  }
  return out;
}

function toNum(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * @param {Object} record { list, common, intro, info }
 * @param {string} atmosphereText - atmosphereBuilder가 만든 문장 (또는 객체 전체)
 * @param {string} [summaryText] - 사용자 노출용 짧은 요약 (옵셔널)
 * @returns {Object} place 테이블 INSERT용 행 (+ tour_content_* 멱등키)
 */
function mapToPlaceRow(record, atmosphereText, summaryText) {
  const list = record.list || {};
  const common = record.common || {};
  const intro = record.intro || {};

  const contentTypeId = String(list.contenttypeid || common.contenttypeid || '') || null;
  const cat3 = common.cat3 || list.cat3 || null;
  const sigunguCode = toNum(list.sigungucode || common.sigungucode);
  const outdoor = isOutdoor(cat3 || '', contentTypeId || '');

  return {
    tour_content_id: String(list.contentid || common.contentid || ''),
    contenttypeid: contentTypeId,
    cat3,
    sigungucode: sigunguCode,
    name: list.title || common.title || '',
    category: mapCategory(cat3, contentTypeId),
    address: list.addr1 || common.addr1 || '',
    lat: toNum(list.mapy || common.mapy),
    lng: toNum(list.mapx || common.mapx),
    operating_hours: pickOperatingHours(intro, contentTypeId),
    photos: pickPhotos(list, common),
    atmosphere_text: atmosphereText,
    summary_text: summaryText || null,
    max_group_size: pickMaxGroupSize(intro, contentTypeId, outdoor),
    is_outdoor: outdoor,
  };
}

export { mapToPlaceRow,
  mapCategory,
  isOutdoor,
  parseHours, };
