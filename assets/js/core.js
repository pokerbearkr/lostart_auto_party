/**
 * 로스트아크 Open API 클라이언트
 * https://developer.smilegate.com
 *
 * 주요 엔드포인트:
 *   GET /characters/{characterName}/siblings
 *     -> 해당 캐릭터의 원정대(같은 계정) 전체 캐릭터 목록 반환
 *     응답 예시: [{ ServerName, CharacterName, CharacterLevel, CharacterClassName, ItemAvgLevel, ItemMaxLevel }, ...]
 */

const API_BASE = 'https://developer.lostark.co.kr';

// localStorage 키
const LS_KEY = 'lostark_party_tool_v1';

// ─── 상태 ───
const state = {
  apiKey: '',
  rosters: [], // [{ repName, characters: [...], fetchedAt }]
  customRaids: [], // 사용자 추가 레이드
  raidOverrides: {}, // 프리셋 레벨 오버라이드 { raidId: { minLevel, maxLevel } }
  assignments: {}, // { raidId: { parties: [[charId, charId, ...], ...] } } - 드래그로 수정된 상태 저장
  excludedChars: new Set(), // 파티에서 제외할 캐릭터 ID
};

// ─── 저장/불러오기 ───
function saveState() {
  const toSave = {
    apiKey: state.apiKey,
    rosters: state.rosters,
    customRaids: state.customRaids,
    raidOverrides: state.raidOverrides,
    assignments: state.assignments,
    excludedChars: Array.from(state.excludedChars),
  };
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(toSave));
  } catch (e) {
    console.error('저장 실패:', e);
  }
}

function loadState() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    state.apiKey = data.apiKey || '';
    state.rosters = data.rosters || [];
    state.customRaids = data.customRaids || [];
    state.raidOverrides = data.raidOverrides || {};
    state.assignments = data.assignments || {};
    state.excludedChars = new Set(data.excludedChars || []);
  } catch (e) {
    console.error('불러오기 실패:', e);
  }
}

// ─── API 호출 ───
async function fetchSiblings(characterName) {
  if (!state.apiKey) {
    throw new Error('API 키를 먼저 입력해주세요.');
  }
  const url = `${API_BASE}/characters/${encodeURIComponent(characterName)}/siblings`;
  const res = await fetch(url, {
    headers: {
      'accept': 'application/json',
      'authorization': `bearer ${state.apiKey}`,
    },
  });
  if (!res.ok) {
    if (res.status === 401) throw new Error('API 키가 유효하지 않습니다.');
    if (res.status === 404) throw new Error(`'${characterName}' 캐릭터를 찾을 수 없습니다.`);
    if (res.status === 429) throw new Error('API 호출 한도 초과. 잠시 후 다시 시도해주세요.');
    throw new Error(`API 오류: ${res.status}`);
  }
  const data = await res.json();
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('원정대 캐릭터가 조회되지 않았습니다.');
  }
  return data;
}

// "1,725.00" 같은 문자열을 숫자로
function parseItemLevel(levelStr) {
  if (typeof levelStr === 'number') return levelStr;
  if (!levelStr) return 0;
  return parseFloat(String(levelStr).replace(/,/g, '')) || 0;
}

// API 응답을 내부 형식으로 변환
function normalizeCharacters(apiCharacters, repName) {
  return apiCharacters.map((c, i) => ({
    id: `${repName}__${c.CharacterName}`, // 원정대명+캐릭명으로 고유 ID
    name: c.CharacterName,
    server: c.ServerName,
    className: c.CharacterClassName,
    level: parseItemLevel(c.ItemMaxLevel || c.ItemAvgLevel),
    isSupport: isSupport(c.CharacterClassName),
    rosterRep: repName, // 어느 원정대 소속인지
  }));
}

// ─── 원정대 관리 ───
async function addRoster(characterName) {
  const siblings = await fetchSiblings(characterName);
  const chars = normalizeCharacters(siblings, characterName);
  // 이미 등록된 원정대는 덮어쓰기
  const idx = state.rosters.findIndex(r => r.repName === characterName);
  const roster = { repName: characterName, characters: chars, fetchedAt: Date.now() };
  if (idx >= 0) state.rosters[idx] = roster;
  else state.rosters.push(roster);
  saveState();
  return roster;
}

function removeRoster(repName) {
  state.rosters = state.rosters.filter(r => r.repName !== repName);
  saveState();
}

async function refreshRoster(repName) {
  return addRoster(repName);
}

// ─── 레이드 정보 가져오기 ───
function getAllRaids() {
  // 프리셋 + 커스텀, 오버라이드 적용
  const presets = RAID_PRESETS.map(r => {
    const ov = state.raidOverrides[r.id];
    return ov ? { ...r, ...ov } : r;
  });
  return [...presets, ...state.customRaids];
}

function getRaidById(id) {
  return getAllRaids().find(r => r.id === id);
}

// ─── 모든 캐릭터 풀 ───
function getAllCharacters() {
  const chars = [];
  for (const roster of state.rosters) {
    for (const ch of roster.characters) {
      if (state.excludedChars.has(ch.id)) continue;
      chars.push(ch);
    }
  }
  return chars;
}

// ─── 파티 매칭 알고리즘 ───
/**
 * 특정 레이드에 맞는 파티를 자동 구성한다.
 *
 * 전략:
 * 1. level 구간 [minLevel, maxLevel) 에 해당하는 캐릭터만 후보로.
 * 2. 딜러/서포터 분리.
 * 3. 서포터는 아이템레벨 오름차순으로 각 파티에 1명씩 배정.
 * 4. 서포터별 파티의 "목표 평균"은 전체 후보 평균레벨.
 *    딜러 3명을 평균 차이가 최소가 되도록 배정.
 * 5. 구체적인 배정:
 *    - 딜러를 레벨 오름차순 정렬.
 *    - 파티 수 P. 각 파티 목표 인원 3명(4인 파티일 때) 혹은 7명(8인 파티 아님 -> 이 프로그램은 4인 파티 기준).
 *    - 파티 수 = floor(딜러 수 / 3) 과 floor(서포터 수) 중 min (서포터 부족시에도 파티 생성)
 *    - 각 파티 평균이 고르도록 뱀처럼 배정(snake draft):
 *      정렬된 딜러를 파티 수 P로 분배. 라운드 1: 0..P-1 파티 순서대로 최상위 딜러.
 *      라운드 2: P-1..0 역순. (balanced distribution)
 *
 * 주의: 본 프로그램은 "4인 파티" 기준으로 동작. 8인 레이드는 4인 파티 2개로 묶임.
 *       partySize가 8이더라도 내부적으로 4인 파티 여러 개를 생성.
 */
function buildParties(raid) {
  const allChars = getAllCharacters();
  const candidates = allChars.filter(c =>
    c.level >= raid.minLevel && c.level < raid.maxLevel
  );

  const dealers = candidates.filter(c => !c.isSupport)
    .sort((a, b) => b.level - a.level); // 내림차순
  const supports = candidates.filter(c => c.isSupport)
    .sort((a, b) => b.level - a.level);

  // 4인 파티 기준: 서포터 1 + 딜러 3
  // 생성 가능한 파티 수
  const maxBySupports = supports.length; // 서포터 1명당 파티 1개
  const maxByDealers = Math.floor(dealers.length / 3);

  // 서포터가 부족해도 딜러 4명으로 임시 파티 생성 (옵션)
  // 기본 정책: 서포터 있는 파티 우선, 남은 딜러는 "서포터 부족" 파티로 별도 표시
  const partyCount = Math.min(maxBySupports, maxByDealers);
  const parties = [];

  // ─── 뱀 배치(snake draft)로 균형있게 분배 ───
  if (partyCount > 0) {
    // 서포터를 각 파티 슬롯에 배치
    for (let i = 0; i < partyCount; i++) {
      parties.push({
        members: [supports[i]],
        support: supports[i],
        dealers: [],
        hasSupport: true,
      });
    }

    // 딜러 뱀 배치: 정렬된 딜러를 한 명씩 돌아가며, 방향을 교대
    const dealersToAssign = dealers.slice(0, partyCount * 3);
    let direction = 1;
    let idx = 0;
    for (let i = 0; i < dealersToAssign.length; i++) {
      parties[idx].dealers.push(dealersToAssign[i]);
      parties[idx].members.push(dealersToAssign[i]);

      // 다음 인덱스
      if (direction === 1) {
        if (idx === partyCount - 1) { direction = -1; }
        else idx++;
      } else {
        if (idx === 0) { direction = 1; }
        else idx--;
      }
    }
  }

  // ─── 서포터 부족 파티(딜러만 4명) ───
  const usedDealerCount = partyCount * 3;
  const leftoverDealers = dealers.slice(usedDealerCount);
  const leftoverSupports = supports.slice(partyCount);

  // 남은 서포터가 있고 딜러가 충분치 못하면, 서포터 부족 파티로 묶음
  const noSupportParties = [];
  // 딜러 4명씩 묶기 (서포터 부족이지만 딜러는 충분한 경우)
  for (let i = 0; i + 4 <= leftoverDealers.length; i += 4) {
    const dealers4 = leftoverDealers.slice(i, i + 4);
    noSupportParties.push({
      members: dealers4,
      support: null,
      dealers: dealers4,
      hasSupport: false,
    });
  }
  const finalLeftover = leftoverDealers.slice(
    Math.floor(leftoverDealers.length / 4) * 4
  );

  // 평균 계산
  const allParties = [...parties, ...noSupportParties].map(p => ({
    ...p,
    avgLevel: p.members.length > 0
      ? p.members.reduce((s, m) => s + m.level, 0) / p.members.length
      : 0,
  }));

  return {
    parties: allParties,
    leftoverDealers: finalLeftover,
    leftoverSupports: leftoverSupports,
    totalCandidates: candidates.length,
  };
}
