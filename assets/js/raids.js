/**
 * 로스트아크 주요 레이드 프리셋
 * minLevel: 입장 가능한 최소 아이템 레벨
 * maxLevel: 다음 난이도가 시작되는 레벨 (이 구간 미만까지만 해당)
 *           -> 즉 [minLevel, maxLevel) 반개구간에서 매칭
 * partySize: 총 입장 인원 (4 = 4인 레이드 → 파티 1개, 8 = 8인 레이드 → 4인 파티 2개)
 * supportsPerParty: 4인 파티 단위 서포터 최소 인원 (보통 1)
 * defaultEnabled: 기본으로 체크된 상태로 표시할지 여부
 *
 * 2026년 4월 기준 KR 서버 입장 레벨.
 * 필요시 사용자가 UI에서 minLevel/maxLevel 수정 가능.
 */
const RAID_PRESETS = [
  // ─── 카제로스 레이드 (8인) ───
  { id: 'egir_n',        name: '에기르 노말',         category: '카제로스', minLevel: 1660, maxLevel: 1680, partySize: 8, supportsPerParty: 1, defaultEnabled: true },
  { id: 'egir_h',        name: '에기르 하드',         category: '카제로스', minLevel: 1680, maxLevel: 1700, partySize: 8, supportsPerParty: 1, defaultEnabled: true },
  { id: 'brelshaza2_n',  name: '아브렐슈드 2막 노말', category: '카제로스', minLevel: 1670, maxLevel: 1690, partySize: 8, supportsPerParty: 1, defaultEnabled: true },
  { id: 'brelshaza2_h',  name: '아브렐슈드 2막 하드', category: '카제로스', minLevel: 1690, maxLevel: 1710, partySize: 8, supportsPerParty: 1, defaultEnabled: true },
  { id: 'mordum_n',      name: '모르둠 노말',         category: '카제로스', minLevel: 1680, maxLevel: 1700, partySize: 8, supportsPerParty: 1, defaultEnabled: true },
  { id: 'mordum_h',      name: '모르둠 하드',         category: '카제로스', minLevel: 1700, maxLevel: 1720, partySize: 8, supportsPerParty: 1, defaultEnabled: true },
  { id: 'armoche_n',     name: '아르모체(4막) 노말', category: '카제로스', minLevel: 1700, maxLevel: 1720, partySize: 8, supportsPerParty: 1, defaultEnabled: true },
  { id: 'armoche_h',     name: '아르모체(4막) 하드', category: '카제로스', minLevel: 1720, maxLevel: 1740, partySize: 8, supportsPerParty: 1, defaultEnabled: true },
  { id: 'jongmak_n',     name: '종막 노말',           category: '카제로스', minLevel: 1710, maxLevel: 1730, partySize: 8, supportsPerParty: 1, defaultEnabled: true },
  { id: 'jongmak_h',     name: '종막 하드',           category: '카제로스', minLevel: 1730, maxLevel: 1760, partySize: 8, supportsPerParty: 1, defaultEnabled: true },
  { id: 'jongmak_first', name: '종막 더 퍼스트',      category: '카제로스', minLevel: 1740, maxLevel: 1800, partySize: 8, supportsPerParty: 1, defaultEnabled: false },

  // ─── 그림자 레이드 (4인) ───
  { id: 'serka_n',  name: '세르카 노말',       category: '그림자', minLevel: 1710, maxLevel: 1730, partySize: 4, supportsPerParty: 1, defaultEnabled: true },
  { id: 'serka_h',  name: '세르카 하드',       category: '그림자', minLevel: 1730, maxLevel: 1740, partySize: 4, supportsPerParty: 1, defaultEnabled: true },
  { id: 'serka_nm', name: '세르카 나이트메어', category: '그림자', minLevel: 1740, maxLevel: 1800, partySize: 4, supportsPerParty: 1, defaultEnabled: true },

  // ─── 어비스 던전 (4인) ───
  { id: 'jipyeong_1', name: '지평의 성당 1단계', category: '어비스', minLevel: 1700, maxLevel: 1720, partySize: 4, supportsPerParty: 1, defaultEnabled: true },
  { id: 'jipyeong_2', name: '지평의 성당 2단계', category: '어비스', minLevel: 1720, maxLevel: 1750, partySize: 4, supportsPerParty: 1, defaultEnabled: true },
  { id: 'jipyeong_3', name: '지평의 성당 3단계', category: '어비스', minLevel: 1750, maxLevel: 1800, partySize: 4, supportsPerParty: 1, defaultEnabled: true },

  // ─── 에픽 레이드 (8인) ───
  { id: 'behemoth_n', name: '베히모스',            category: '에픽', minLevel: 1620, maxLevel: 1660, partySize: 8, supportsPerParty: 1, defaultEnabled: false },
  { id: 'echidna_n',  name: '에키드나(서막) 노말', category: '에픽', minLevel: 1620, maxLevel: 1640, partySize: 8, supportsPerParty: 1, defaultEnabled: false },
  { id: 'echidna_h',  name: '에키드나(서막) 하드', category: '에픽', minLevel: 1640, maxLevel: 1660, partySize: 8, supportsPerParty: 1, defaultEnabled: false },

  // ─── 군단장 레이드 (8인) - 구버전, 기본 비활성화 ───
  { id: 'kamen_h',    name: '카멘 하드',       category: '군단장', minLevel: 1630, maxLevel: 1680, partySize: 8, supportsPerParty: 1, defaultEnabled: false },
  { id: 'kamen_n',    name: '카멘 노말',       category: '군단장', minLevel: 1610, maxLevel: 1630, partySize: 8, supportsPerParty: 1, defaultEnabled: false },
  { id: 'illiakan_h', name: '일리아칸 하드',   category: '군단장', minLevel: 1600, maxLevel: 1620, partySize: 8, supportsPerParty: 1, defaultEnabled: false },
  { id: 'illiakan_n', name: '일리아칸 노말',   category: '군단장', minLevel: 1580, maxLevel: 1600, partySize: 8, supportsPerParty: 1, defaultEnabled: false },
];

// 서포터 직업 목록 (로스트아크 서포터 4종)
const SUPPORT_CLASSES = ['바드', '홀리나이트', '도화가', '발키리'];

// 서포터 여부 판별 함수
function isSupport(className) {
  if (!className) return false;
  return SUPPORT_CLASSES.some(sup => className.includes(sup));
}
