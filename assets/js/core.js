/**
 * 로스트아크 Open API 클라이언트
 * https://developer-lostark.game.onstove.com
 *
 * 주요 엔드포인트:
 *   GET /characters/{characterName}/siblings
 *     -> 해당 캐릭터의 원정대(같은 계정) 전체 캐릭터 목록 반환
 *     응답 예시: [{ ServerName, CharacterName, CharacterLevel, CharacterClassName, ItemAvgLevel, ItemMaxLevel }, ...]
 */

const API_BASE = 'https://developer-lostark.game.onstove.com';

// localStorage 키
const LS_KEY = 'lostark_party_tool_v2';

// ─── 상태 ───
const state = {
  apiKey: '',
  rosters: [],           // [{ repName, characters: [...], fetchedAt }]
  customRaids: [],       // 사용자 추가 레이드
  raidOverrides: {},     // 프리셋 레벨 오버라이드 { raidId: { minLevel, maxLevel } }
  excludedChars: new Set(), // 파티에서 제외할 캐릭터 ID
  enabledRaids: null,    // 사용자가 직접 체크한 레이드 id Set. null이면 아직 초기화 안됨 (defaultEnabled 사용)
};

// ─── 저장/불러오기 ───
function saveState() {
  const toSave = {
    apiKey: state.apiKey,
    rosters: state.rosters,
    customRaids: state.customRaids,
    raidOverrides: state.raidOverrides,
    excludedChars: Array.from(state.excludedChars),
    enabledRaids: state.enabledRaids ? Array.from(state.enabledRaids) : null,
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
    state.excludedChars = new Set(data.excludedChars || []);
    state.enabledRaids = Array.isArray(data.enabledRaids) ? new Set(data.enabledRaids) : null;
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

function parseItemLevel(levelStr) {
  if (typeof levelStr === 'number') return levelStr;
  if (!levelStr) return 0;
  return parseFloat(String(levelStr).replace(/,/g, '')) || 0;
}

function normalizeCharacters(apiCharacters, repName) {
  return apiCharacters.map((c) => ({
    id: `${repName}__${c.CharacterName}`,
    name: c.CharacterName,
    server: c.ServerName,
    className: c.CharacterClassName,
    level: parseItemLevel(c.ItemMaxLevel || c.ItemAvgLevel),
    isSupport: isSupport(c.CharacterClassName),
    rosterRep: repName,
  }));
}

// ─── 원정대 관리 ───
async function addRoster(characterName) {
  const siblings = await fetchSiblings(characterName);
  const chars = normalizeCharacters(siblings, characterName);
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

// ─── 레이드 정보 ───
function getAllRaids() {
  const presets = RAID_PRESETS.map(r => {
    const ov = state.raidOverrides[r.id];
    return ov ? { ...r, ...ov } : r;
  });
  return [...presets, ...state.customRaids];
}

function getRaidById(id) {
  return getAllRaids().find(r => r.id === id);
}

// 특정 레이드가 활성화(체크)된 상태인지 확인
function isRaidEnabled(raid) {
  if (state.enabledRaids === null) {
    // 초기 상태: defaultEnabled 따름 (커스텀은 기본 true)
    return raid.defaultEnabled !== false;
  }
  return state.enabledRaids.has(raid.id);
}

// 레이드 활성화 토글
function toggleRaidEnabled(raidId, enabled) {
  // 처음 토글이면 enabledRaids를 초기화 (defaultEnabled 기반으로)
  if (state.enabledRaids === null) {
    state.enabledRaids = new Set(
      getAllRaids().filter(r => r.defaultEnabled !== false).map(r => r.id)
    );
  }
  if (enabled) state.enabledRaids.add(raidId);
  else state.enabledRaids.delete(raidId);
  saveState();
}

// 모든 캐릭터 풀 (제외 처리 포함)
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
 * 주요 제약:
 *  (1) 레벨 구간 [minLevel, maxLevel) 에 해당하는 캐릭터만 후보
 *  (2) 한 파티에 같은 원정대(rosterRep) 캐릭은 1명만 (로스트아크 실제 입장 제약)
 *  (3) 4인 파티 = 서포터 1 + 딜러 3 (또는 서포터 부족시 딜러 4)
 *
 * 생성 파티 수:
 *  - 4인 레이드 (partySize=4) → 최대 1개
 *  - 8인 레이드 (partySize=8) → 4인 파티 최대 2개
 *  - 프리셋에 없는 값도 4인 파티 단위로 계산 (partySize / 4)
 *
 * 알고리즘 (원정대 중복 제한을 만족하면서 평균 균등 분배):
 *  1) 딜러/서포터 분리 후 레벨 내림차순 정렬
 *  2) targetPartyCount = partySize / 4, 이를 상한으로 사용
 *  3) 서포터를 원정대별로 중복 안 되게 최대 targetPartyCount 만큼 선택해 각 파티에 배치
 *  4) 딜러는 snake-draft로 파티에 배정하되, 이미 같은 원정대 캐릭이 있는 파티는 건너뜀
 *     - 배정 불가(모든 파티에 해당 원정대가 이미 있음)면 '남은 캐릭터'로 보냄
 *  5) 각 파티가 딜러 3명을 채울 때까지 반복
 *  6) 서포터 부족 파티는 별도로 '⚠ 서포터 부족' 표시
 */
function buildParties(raid) {
  const allChars = getAllCharacters();
  const candidates = allChars.filter(c =>
    c.level >= raid.minLevel && c.level < raid.maxLevel
  );

  const dealers = candidates.filter(c => !c.isSupport)
    .sort((a, b) => b.level - a.level);
  const supports = candidates.filter(c => c.isSupport)
    .sort((a, b) => b.level - a.level);

  // 4인 파티 단위 목표 개수
  const partySize = raid.partySize || 8;
  const targetPartyCount = Math.max(1, Math.floor(partySize / 4));
  const DEALERS_PER_PARTY = 3;

  // 파티 인스턴스 (서포터 우선 배치)
  const parties = [];

  // ─── 1단계: 서포터 배치 (원정대 중복 방지) ───
  const usedRosters = []; // 각 파티가 포함한 rosterRep 집합
  const usedSupportIds = new Set();

  for (let i = 0; i < targetPartyCount; i++) {
    // 아직 사용되지 않은 원정대의 서포터 중 가장 레벨 높은 사람 선택
    const picked = supports.find(s => {
      if (usedSupportIds.has(s.id)) return false;
      // 기존 파티들에서 이미 이 원정대가 사용됐는지 확인(현재는 파티가 하나씩 생기므로 단순 중복체크)
      // 서포터끼리 원정대 중복도 방지 (같은 원정대 서포터가 여러 파티에 나뉘는 건 OK)
      return true;
    });
    if (!picked) break;
    usedSupportIds.add(picked.id);
    parties.push({
      members: [picked],
      support: picked,
      dealers: [],
      hasSupport: true,
      rosterSet: new Set([picked.rosterRep]),
    });
    usedRosters.push(picked.rosterRep);
  }

  // 서포터 부족으로 파티가 부족하면, 딜러 4명짜리 "서포터 부족" 파티를 추가로 만들 준비
  // (여기선 아직 안 만들고, 딜러 배정 끝난 뒤 남은 딜러로 만든다)
  const supportShortParties = targetPartyCount - parties.length;

  // ─── 2단계: 딜러 snake-draft 배정, 단 원정대 중복 제한 ───
  // partyCount == 0 이면 건너뜀 (아래에서 다시 처리)
  const usedDealerIds = new Set();
  if (parties.length > 0) {
    // snake-draft 순서: [0,1,...,n-1, n-1,...,0, 0,...,n-1, ...]
    // 각 파티가 DEALERS_PER_PARTY 명 될 때까지
    const n = parties.length;
    let direction = 1;
    let idx = 0;
    let round = 0;
    const maxRounds = DEALERS_PER_PARTY * 2 + 2; // 안전장치

    while (round < maxRounds) {
      let assignedInThisRound = 0;
      for (let step = 0; step < n; step++) {
        const party = parties[idx];
        if (party.dealers.length < DEALERS_PER_PARTY) {
          // 이 파티에 들어갈 수 있는 딜러 찾기
          const picked = pickDealerForParty(dealers, usedDealerIds, party.rosterSet);
          if (picked) {
            usedDealerIds.add(picked.id);
            party.dealers.push(picked);
            party.members.push(picked);
            party.rosterSet.add(picked.rosterRep);
            assignedInThisRound++;
          }
        }
        // 다음 인덱스 (snake)
        if (direction === 1) {
          if (idx === n - 1) { direction = -1; }
          else idx++;
        } else {
          if (idx === 0) { direction = 1; }
          else idx--;
        }
      }
      // 모든 파티가 다 찼으면 종료
      if (parties.every(p => p.dealers.length >= DEALERS_PER_PARTY)) break;
      // 한 라운드에 한 명도 못 넣었으면 종료 (더 넣을 수 없음)
      if (assignedInThisRound === 0) break;
      round++;
    }
  }

  // ─── 3단계: 서포터 부족 파티 (남은 딜러 4명씩) ───
  // 단, 원정대 중복 제약 유지
  const noSupportParties = [];
  if (supportShortParties > 0) {
    for (let p = 0; p < supportShortParties; p++) {
      const partyRosters = new Set();
      const partyMembers = [];
      // 가장 레벨 높은 미사용 딜러부터 순회, 원정대 중복 안 되면 추가
      for (const d of dealers) {
        if (usedDealerIds.has(d.id)) continue;
        if (partyRosters.has(d.rosterRep)) continue;
        partyMembers.push(d);
        partyRosters.add(d.rosterRep);
        usedDealerIds.add(d.id);
        if (partyMembers.length >= 4) break;
      }
      if (partyMembers.length >= 4) {
        noSupportParties.push({
          members: partyMembers,
          support: null,
          dealers: partyMembers,
          hasSupport: false,
          rosterSet: partyRosters,
        });
      } else {
        // 4명을 못 채우면 그대로 두고 종료 (나머지는 leftover로)
        // 이미 추가한 것들도 다시 사용 가능하도록 되돌림
        partyMembers.forEach(m => usedDealerIds.delete(m.id));
        break;
      }
    }
  }

  // ─── 4단계: 남은 캐릭터 (배정 안 된 딜러/서포터) ───
  const leftoverDealers = dealers.filter(d => !usedDealerIds.has(d.id));
  const leftoverSupports = supports.filter(s => !usedSupportIds.has(s.id));

  // 평균 계산
  const allParties = [...parties, ...noSupportParties].map(p => ({
    ...p,
    // rosterSet은 직렬화 필요 없으므로 제거
    rosterSet: undefined,
    avgLevel: p.members.length > 0
      ? p.members.reduce((s, m) => s + m.level, 0) / p.members.length
      : 0,
  }));

  return {
    parties: allParties,
    leftoverDealers,
    leftoverSupports,
    totalCandidates: candidates.length,
    targetPartyCount,
  };
}

/**
 * 딜러 목록에서 이 파티에 넣을 수 있는 최상위 레벨 딜러를 고른다.
 * - 이미 사용된 딜러 제외
 * - 이미 파티에 같은 원정대 캐릭이 있으면 제외
 */
function pickDealerForParty(dealers, usedDealerIds, partyRosterSet) {
  for (const d of dealers) {
    if (usedDealerIds.has(d.id)) continue;
    if (partyRosterSet.has(d.rosterRep)) continue;
    return d;
  }
  return null;
}
