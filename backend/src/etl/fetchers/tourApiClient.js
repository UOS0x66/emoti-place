/**
 * TourAPI 2.0 (KorService2) 클라이언트
 *
 * 데이터 인프라 (김현수 담당) — TourAPI에서 장소 raw 데이터 수집.
 * 환경변수 TOUR_API_SERVICE_KEY 필요 (공공데이터포털 디코딩 키).
 */

const BASE_URL = 'https://apis.data.go.kr/B551011/KorService2';

const TARGET_CONTENT_TYPES = {
  TOURIST_SPOT: 12,
  CULTURAL: 14,
  LEPORTS: 28,
  RESTAURANT: 39,
};

const AREA_CODE = {
  SEOUL: 1,
  BUSAN: 6,
};

const SEOUL_SIGUNGU = {
  GANGNAM: 1, GANGDONG: 2, GANGBUK: 3, GANGSEO: 4, GWANAK: 5,
  GWANGJIN: 6, GURO: 7, GEUMCHEON: 8, NOWON: 9, DOBONG: 10,
  DONGDAEMUN: 11, DONGJAK: 12, MAPO: 13, SEODAEMUN: 14, SEOCHO: 15,
  SEONGDONG: 16, SEONGBUK: 17, SONGPA: 18, YANGCHEON: 19, YEONGDEUNGPO: 20,
  YONGSAN: 21, EUNPYEONG: 22, JONGNO: 23, JUNG: 24, JUNGNANG: 25,
};

function buildCommonParams() {
  const serviceKey = process.env.TOUR_API_SERVICE_KEY;
  if (!serviceKey) {
    throw new Error('TOUR_API_SERVICE_KEY 환경변수가 설정되지 않았습니다.');
  }
  return { serviceKey, MobileOS: 'ETC', MobileApp: 'EmotiPlace', _type: 'json' };
}

function buildUrl(endpoint, params) {
  const url = new URL(`${BASE_URL}/${endpoint}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') {
      url.searchParams.append(k, v);
    }
  }
  return url.toString();
}

function parseResponse(json) {
  const header = json && json.response && json.response.header;
  if (!header) throw new Error('TourAPI 응답 형식 오류: response.header 없음');
  if (header.resultCode !== '0000') {
    throw new Error(`TourAPI 에러 [${header.resultCode}]: ${header.resultMsg}`);
  }
  const body = json.response.body || {};
  const rawItems = body.items;
  let items = [];
  if (rawItems && typeof rawItems === 'object' && rawItems.item) {
    items = Array.isArray(rawItems.item) ? rawItems.item : [rawItems.item];
  }
  return {
    items,
    totalCount: Number(body.totalCount || 0),
    pageNo: Number(body.pageNo || 1),
    numOfRows: Number(body.numOfRows || 0),
  };
}

async function fetchWithRetry(url, { maxRetries = 3, timeoutMs = 10000 } = {}) {
  let lastError;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      return await res.json();
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries - 1) {
        await new Promise((r) => setTimeout(r, 2 ** attempt * 500));
      }
    }
  }
  throw new Error(`TourAPI 호출 실패 (${maxRetries}회 재시도): ${lastError.message}`);
}

async function fetchAreaBasedListPage({ areaCode, sigunguCode, contentTypeId, pageNo = 1, numOfRows = 100 }) {
  const url = buildUrl('areaBasedList2', {
    ...buildCommonParams(),
    areaCode, sigunguCode, contentTypeId, pageNo, numOfRows,
    arrange: 'A',
  });
  const json = await fetchWithRetry(url);
  return parseResponse(json);
}

async function* fetchAreaBasedListAll(options) {
  const numOfRows = options.numOfRows || 100;
  let pageNo = 1;
  while (true) {
    const { items, totalCount } = await fetchAreaBasedListPage({ ...options, pageNo, numOfRows });
    if (items.length === 0) break;
    for (const item of items) yield item;
    if (pageNo * numOfRows >= totalCount) break;
    pageNo += 1;
    await new Promise((r) => setTimeout(r, 200));
  }
}

async function fetchDetailCommon(contentId) {
  const url = buildUrl('detailCommon2', { ...buildCommonParams(), contentId });
  const json = await fetchWithRetry(url);
  const { items } = parseResponse(json);
  return items[0] || null;
}

async function fetchDetailIntro(contentId, contentTypeId) {
  const url = buildUrl('detailIntro2', { ...buildCommonParams(), contentId, contentTypeId });
  const json = await fetchWithRetry(url);
  const { items } = parseResponse(json);
  return items[0] || null;
}

async function fetchDetailInfo(contentId, contentTypeId) {
  const url = buildUrl('detailInfo2', { ...buildCommonParams(), contentId, contentTypeId });
  const json = await fetchWithRetry(url);
  const { items } = parseResponse(json);
  return items;
}

async function fetchPlaceFullDetails(contentId, contentTypeId) {
  const [common, intro, info] = await Promise.all([
    fetchDetailCommon(contentId),
    fetchDetailIntro(contentId, contentTypeId),
    fetchDetailInfo(contentId, contentTypeId),
  ]);
  return { common, intro, info };
}

module.exports = {
  TARGET_CONTENT_TYPES,
  AREA_CODE,
  SEOUL_SIGUNGU,
  fetchAreaBasedListPage,
  fetchAreaBasedListAll,
  fetchDetailCommon,
  fetchDetailIntro,
  fetchDetailInfo,
  fetchPlaceFullDetails,
};
