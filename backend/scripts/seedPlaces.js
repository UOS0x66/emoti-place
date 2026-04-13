require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// 개발용 서울 장소 mock 데이터
const MOCK_PLACES = [
  {
    name: '숲속 쉼터 카페',
    category: '카페',
    address: '서울특별시 성동구 서울숲2길 32-8',
    lat: 37.5445,
    lng: 127.0374,
    atmosphere_text: '조용하고 따뜻한 분위기의 카페. 큰 창문으로 자연광이 들어오고, 혼자 앉아 생각에 잠기기 좋은 공간. 식물이 많아 치유의 느낌을 준다.',
    operating_hours: { open: '09:00', close: '22:00' },
    max_group_size: 4,
    is_outdoor: false,
  },
  {
    name: '남산 둘레길',
    category: '산책로',
    address: '서울특별시 중구 남산공원길 일대',
    lat: 37.5512,
    lng: 126.9882,
    atmosphere_text: '도심 속 자연을 느낄 수 있는 산책로. 나무와 새소리에 둘러싸여 걸으며 마음을 비울 수 있다. 사계절 아름다운 경관.',
    operating_hours: { open: '00:00', close: '23:59' },
    max_group_size: 20,
    is_outdoor: true,
  },
  {
    name: '을지로 골목 맛집',
    category: '음식점',
    address: '서울특별시 중구 을지로 14길 8',
    lat: 37.566,
    lng: 126.991,
    atmosphere_text: '오래된 골목의 정취가 살아있는 따뜻한 음식점. 푸짐한 집밥 느낌의 음식이 위로가 되는 공간. 혼밥도 편안하게 가능.',
    operating_hours: { open: '11:00', close: '21:00' },
    max_group_size: 6,
    is_outdoor: false,
  },
  {
    name: '한강 뚝섬유원지',
    category: '공원',
    address: '서울특별시 광진구 자양동 한강공원',
    lat: 37.5317,
    lng: 127.066,
    atmosphere_text: '넓은 한강변에서 바람을 맞으며 산책하거나 자전거를 탈 수 있는 공간. 에너지를 발산하기 좋고, 친구와 함께 피크닉도 가능.',
    operating_hours: { open: '00:00', close: '23:59' },
    max_group_size: 30,
    is_outdoor: true,
  },
  {
    name: '북촌 한옥 찻집',
    category: '카페',
    address: '서울특별시 종로구 북촌로 44',
    lat: 37.5826,
    lng: 126.9849,
    atmosphere_text: '전통 한옥에서 따뜻한 차를 마시며 여유를 즐길 수 있는 곳. 조용하고 고즈넉한 분위기가 마음의 안정을 가져다준다.',
    operating_hours: { open: '10:00', close: '20:00' },
    max_group_size: 8,
    is_outdoor: false,
  },
  {
    name: '연남동 경의선 숲길',
    category: '산책로',
    address: '서울특별시 마포구 연남동 경의선 숲길',
    lat: 37.5658,
    lng: 126.9236,
    atmosphere_text: '도심 속 작은 숲길. 천천히 걸으며 예쁜 가게들을 구경하고, 벤치에 앉아 사람들을 관찰하기 좋다. 활기차면서도 편안한 곳.',
    operating_hours: { open: '00:00', close: '23:59' },
    max_group_size: 10,
    is_outdoor: true,
  },
  {
    name: '익선동 소품샵 거리',
    category: '문화공간',
    address: '서울특별시 종로구 익선동 166',
    lat: 37.5748,
    lng: 126.9884,
    atmosphere_text: '작고 아기자기한 소품샵과 갤러리가 모인 골목. 새로운 것을 발견하는 설렘과 호기심을 채워주는 공간.',
    operating_hours: { open: '11:00', close: '21:00' },
    max_group_size: 4,
    is_outdoor: false,
  },
  {
    name: '이태원 세계음식 거리',
    category: '음식점',
    address: '서울특별시 용산구 이태원로 일대',
    lat: 37.5345,
    lng: 126.9946,
    atmosphere_text: '다양한 나라의 음식을 맛볼 수 있는 이국적인 거리. 친구들과 함께 새로운 맛을 탐험하며 기분 전환하기 좋다.',
    operating_hours: { open: '11:00', close: '23:00' },
    max_group_size: 10,
    is_outdoor: false,
  },
  {
    name: '올림픽공원 평화의 광장',
    category: '공원',
    address: '서울특별시 송파구 올림픽로 424',
    lat: 37.5202,
    lng: 127.1212,
    atmosphere_text: '넓은 잔디밭과 조각 작품이 어우러진 공간. 드넓은 하늘 아래 앉아 아무 생각 없이 쉬기 좋다. 혼자 와도 외롭지 않은 곳.',
    operating_hours: { open: '05:00', close: '22:00' },
    max_group_size: 50,
    is_outdoor: true,
  },
  {
    name: '성수동 카페 거리',
    category: '카페',
    address: '서울특별시 성동구 성수이로 일대',
    lat: 37.5447,
    lng: 127.0558,
    atmosphere_text: '트렌디한 분위기의 카페들이 밀집한 거리. 감각적인 인테리어와 좋은 커피로 기분 전환에 최적. 사진 찍기에도 좋다.',
    operating_hours: { open: '10:00', close: '22:00' },
    max_group_size: 6,
    is_outdoor: false,
  },
];

async function main() {
  try {
    console.log('장소 데이터 시드 중...');

    for (const place of MOCK_PLACES) {
      await pool.query(
        `INSERT INTO place (name, category, address, lat, lng, operating_hours, atmosphere_text, max_group_size, is_outdoor)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT DO NOTHING`,
        [
          place.name,
          place.category,
          place.address,
          place.lat,
          place.lng,
          JSON.stringify(place.operating_hours),
          place.atmosphere_text,
          place.max_group_size,
          place.is_outdoor,
        ]
      );
      console.log(`  ✓ ${place.name}`);
    }

    console.log('장소 시드 완료!');
  } catch (err) {
    console.error('시드 실패:', err.message);
  } finally {
    await pool.end();
  }
}

main();
