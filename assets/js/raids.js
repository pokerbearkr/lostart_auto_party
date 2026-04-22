/**
 * 로스트아크 주요 레이드 프리셋
 * minLevel: 입장 가능한 최소 아이템 레벨
 * maxLevel: 다음 난이도가 시작되는 레벨 (이 구간 미만까지만 해당)
 *           -> 즉 [minLevel, maxLevel) 반개구간에서 매칭
 * partySize: 파티당 인원 (4 = 4인 파티, 8 = 8인 레이드는 4인 파티 x2)
 * supportsPerParty: 파티당 서포터 최소 인원
 *
 * 2026년 4월 기준 KR 서버 입장 레벨. 필요시 사용자가 UI에서 수정 가능.
 */
const RAID_PRESETS = [
  // ─── 군단장 레이드 (티어 3) ───
  { id: 'valtan_n',       name: '발탄 노말',        category: '군단장',   minLevel: 1415, maxLevel: 1445, partySize: 8, supportsPerParty: 1 },
  { id: 'valtan_h',       name: '발탄 하드',        category: '군단장',   minLevel: 1445, maxLevel: 1460, partySize: 8, supportsPerParty: 1 },
  { id: 'biackiss_n',     name: '비아키스 노말',    category: '군단장',   minLevel: 1430, maxLevel: 1460, partySize: 8, supportsPerParty: 1 },
  { id: 'biackiss_h',     name: '비아키스 하드',    category: '군단장',   minLevel: 1460, maxLevel: 1475, partySize: 8, supportsPerParty: 1 },
  { id: 'kouku_n',        name: '쿠크세이튼 노말',  category: '군단장',   minLevel: 1475, maxLevel: 1540, partySize: 8, supportsPerParty: 1 },
  { id: 'abrel_n',        name: '아브렐슈드 노말',  category: '군단장',   minLevel: 1490, maxLevel: 1540, partySize: 8, supportsPerParty: 1 },
  { id: 'abrel_h',        name: '아브렐슈드 하드',  category: '군단장',   minLevel: 1540, maxLevel: 1580, partySize: 8, supportsPerParty: 1 },
  { id: 'illiakan_n',     name: '일리아칸 노말',    category: '군단장',   minLevel: 1580, maxLevel: 1600, partySize: 8, supportsPerParty: 1 },
  { id: 'illiakan_h',     name: '일리아칸 하드',    category: '군단장',   minLevel: 1600, maxLevel: 1620, partySize: 8, supportsPerParty: 1 },
  { id: 'kamen_n',        name: '카멘 노말',        category: '군단장',   minLevel: 1610, maxLevel: 1630, partySize: 8, supportsPerParty: 1 },
  { id: 'kamen_h',        name: '카멘 하드',        category: '군단장',   minLevel: 1630, maxLevel: 1680, partySize: 8, supportsPerParty: 1 },

  // ─── 에픽 레이드 ───
  { id: 'behemoth_n',     name: '베히모스 노말',    category: '에픽',     minLevel: 1620, maxLevel: 1640, partySize: 8, supportsPerParty: 1 },

  // ─── 카제로스 레이드 (티어 4) ───
  { id: 'echidna_n',      name: '에키드나(서막) 노말', category: '카제로스', minLevel: 1620, maxLevel: 1640, partySize: 8, supportsPerParty: 1 },
  { id: 'echidna_h',      name: '에키드나(서막) 하드', category: '카제로스', minLevel: 1640, maxLevel: 1660, partySize: 8, supportsPerParty: 1 },
  { id: 'egir_n',         name: '에기르 노말',      category: '카제로스', minLevel: 1660, maxLevel: 1680, partySize: 8, supportsPerParty: 1 },
  { id: 'egir_h',         name: '에기르 하드',      category: '카제로스', minLevel: 1680, maxLevel: 1700, partySize: 8, supportsPerParty: 1 },
  { id: 'brelshaza2_n',   name: '아브렐슈드 2막 노말', category: '카제로스', minLevel: 1670, maxLevel: 1690, partySize: 8, supportsPerParty: 1 },
  { id: 'brelshaza2_h',   name: '아브렐슈드 2막 하드', category: '카제로스', minLevel: 1690, maxLevel: 1710, partySize: 8, supportsPerParty: 1 },
  { id: 'mordum_n',       name: '모르둠 노말',      category: '카제로스', minLevel: 1680, maxLevel: 1700, partySize: 8, supportsPerParty: 1 },
  { id: 'mordum_h',       name: '모르둠 하드',      category: '카제로스', minLevel: 1700, maxLevel: 1720, partySize: 8, supportsPerParty: 1 },
  { id: 'armoche_n',      name: '아르모체(4막) 노말', category: '카제로스', minLevel: 1700, maxLevel: 1720, partySize: 8, supportsPerParty: 1 },
  { id: 'armoche_h',      name: '아르모체(4막) 하드', category: '카제로스', minLevel: 1720, maxLevel: 1740, partySize: 8, supportsPerParty: 1 },
  { id: 'seha_n',         name: '세하(종막) 노말',  category: '카제로스', minLevel: 1710, maxLevel: 1730, partySize: 8, supportsPerParty: 1 },
  { id: 'seha_h',         name: '세하(종막) 하드',  category: '카제로스', minLevel: 1730, maxLevel: 1760, partySize: 8, supportsPerParty: 1 },
  { id: 'seha_first',     name: '세하(종막) 더 퍼스트', category: '카제로스', minLevel: 1740, maxLevel: 1800, partySize: 8, supportsPerParty: 1 },
];

// 서포터 직업 목록 (로스트아크 서포터 4종)
const SUPPORT_CLASSES = ['바드', '홀리나이트', '도화가', '발키리'];

// 서포터 여부 판별 함수
function isSupport(className) {
  if (!className) return false;
  return SUPPORT_CLASSES.some(sup => className.includes(sup));
}
