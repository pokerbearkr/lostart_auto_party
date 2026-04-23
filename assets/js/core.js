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

/**
 * 단일 캐릭터의 전투력을 가져온다.
 * /armories/characters/{name}?filters=profiles 요청 후 ArmoryProfile.CombatPower 추출.
 * 실패 시 null 반환 (호출측에서 템레벨만 써서 폴백).
 */
async function fetchCombatPower(characterName) {
  if (!state.apiKey) return null;
  const url = `${API_BASE}/armories/characters/${encodeURIComponent(characterName)}?filters=profiles`;
  try {
    const res = await fetch(url, {
      headers: {
        'accept': 'application/json',
        'authorization': `bearer ${state.apiKey}`,
      },
    });
    if (!res.ok) {
      if (res.status === 429) throw new Error('RATE_LIMIT');
      return null;
    }
    const data = await res.json();
    if (!data || !data.ArmoryProfile) return null;
    // CombatPower는 "3,492.58" 같은 문자열이거나 숫자로 옴
    const cp = data.ArmoryProfile.CombatPower;
    if (cp == null) return null;
    return parseItemLevel(cp); // 쉼표 제거 + parseFloat
  } catch (e) {
    if (e.message === 'RATE_LIMIT') throw e;
    return null;
  }
}

// 호출 간격 조절 (분당 100회 제한 대응: 호출당 100ms = 분당 600회 이하지만 넉넉히 150ms)
const API_DELAY_MS = 150;
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

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
    combatPower: 0, // 전투력 - addRoster에서 armories API로 별도 채움
    isSupport: isSupport(c.CharacterClassName),
    rosterRep: repName,
  }));
}

// ─── 원정대 관리 ───
/**
 * 캐릭터 하나를 기준으로 원정대 전체를 불러온다.
 * 1단계: siblings API로 모든 캐릭터 목록 + 템레벨 가져오기
 * 2단계: 각 캐릭터의 armories API를 순차 호출하여 전투력 채우기
 *
 * onProgress(current, total, msg): 진행도 콜백 (선택)
 */
async function addRoster(characterName, onProgress) {
  // 1) 원정대 목록
  if (onProgress) onProgress(0, 1, '원정대 목록 불러오는 중...');
  const siblings = await fetchSiblings(characterName);
  const chars = normalizeCharacters(siblings, characterName);

  // 2) 각 캐릭터 전투력 조회 (순차 호출, 레이트 리밋 대응)
  const total = chars.length;
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (onProgress) onProgress(i + 1, total, `전투력 조회: ${ch.name}`);
    try {
      const cp = await fetchCombatPower(ch.name);
      ch.combatPower = cp || 0;
    } catch (e) {
      if (e.message === 'RATE_LIMIT') {
        // 레이트 리밋 히트 - 10초 대기 후 재시도 1번
        if (onProgress) onProgress(i + 1, total, '호출 한도 초과, 10초 대기...');
        await sleep(10000);
        try {
          const cp = await fetchCombatPower(ch.name);
          ch.combatPower = cp || 0;
        } catch (_) {
          ch.combatPower = 0;
        }
      }
    }
    if (i < chars.length - 1) await sleep(API_DELAY_MS);
  }

  // 3) 저장
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
 * 설계 원칙:
 *  (1) 입장 가능 여부: 아이템 레벨 기준 [minLevel, maxLevel) 필터
 *  (2) 파티 균형: 전투력(combatPower) 기준 snake-draft
 *  (3) 한 파티에 같은 원정대(rosterRep) 1명만 (로스트아크 실제 입장 제약)
 *  (4) 4인 파티 = 서포터 1 + 딜러 3 (또는 서포터 부족 시 딜러 4)
 *
 * 공격대(raidGroup) 단위:
 *  - 4인 레이드(partySize=4): 1공격대 = 파티 1개
 *  - 8인 레이드(partySize=8): 1공격대 = 파티 2개
 *
 * 여러 공격대 생성:
 *  - 남은 후보로 다음 공격대 계속 만들기
 *  - 한 공격대의 파티를 단 하나도 못 만들면 종료
 *
 * 전투력 0인 캐릭터 처리:
 *  - 전투력 못 받아온 캐릭은 아이템 레벨 * 2 를 임시값으로 사용 (대략적 비례)
 *  - UI에서는 해당 캐릭 칩에 ⚠ 표시
 */
function buildParties(raid) {
  const allChars = getAllCharacters();
  const candidates = allChars.filter(c =>
    c.level >= raid.minLevel && c.level < raid.maxLevel
  );

  // 전투력 없으면 템레벨 기반 임시값 사용
  const powerOf = (c) => c.combatPower > 0 ? c.combatPower : c.level * 2;

  const partySize = raid.partySize || 8;
  const partiesPerGroup = Math.max(1, Math.floor(partySize / 4)); // 공격대당 4인 파티 수

  const raidGroups = []; // [{ parties: [...] }, ...]
  const usedIds = new Set();

  // 공격대를 반복 생성
  while (true) {
    // 남은 후보
    const remaining = candidates.filter(c => !usedIds.has(c.id));
    const remDealers = remaining.filter(c => !c.isSupport)
      .sort((a, b) => powerOf(b) - powerOf(a));
    const remSupports = remaining.filter(c => c.isSupport)
      .sort((a, b) => powerOf(b) - powerOf(a));

    // 이번 공격대 파티들
    const groupParties = [];
    const groupUsedIds = new Set();

    // 1) 서포터를 각 파티에 1명씩 배치
    for (let i = 0; i < partiesPerGroup; i++) {
      const picked = remSupports.find(s => !groupUsedIds.has(s.id));
      if (!picked) break;
      groupUsedIds.add(picked.id);
      groupParties.push({
        members: [picked],
        support: picked,
        dealers: [],
        hasSupport: true,
        rosterSet: new Set([picked.rosterRep]),
      });
    }

    const supportShort = partiesPerGroup - groupParties.length;

    // 2) 딜러 snake-draft (전투력 내림차순 기준, 원정대 중복 금지)
    if (groupParties.length > 0) {
      const n = groupParties.length;
      let direction = 1, idx = 0, round = 0;
      const maxRounds = 10;
      while (round < maxRounds) {
        let assignedInRound = 0;
        for (let step = 0; step < n; step++) {
          const party = groupParties[idx];
          if (party.dealers.length < 3) {
            const picked = pickDealerForParty(remDealers, groupUsedIds, party.rosterSet);
            if (picked) {
              groupUsedIds.add(picked.id);
              party.dealers.push(picked);
              party.members.push(picked);
              party.rosterSet.add(picked.rosterRep);
              assignedInRound++;
            }
          }
          if (direction === 1) {
            if (idx === n - 1) direction = -1; else idx++;
          } else {
            if (idx === 0) direction = 1; else idx--;
          }
        }
        if (groupParties.every(p => p.dealers.length >= 3)) break;
        if (assignedInRound === 0) break;
        round++;
      }
    }

    // 3) 서포터 부족 파티: 남은 딜러 4명으로 채우기
    const noSupportParties = [];
    if (supportShort > 0) {
      for (let p = 0; p < supportShort; p++) {
        const partyRosters = new Set();
        const partyMembers = [];
        for (const d of remDealers) {
          if (groupUsedIds.has(d.id)) continue;
          if (partyRosters.has(d.rosterRep)) continue;
          partyMembers.push(d);
          partyRosters.add(d.rosterRep);
          groupUsedIds.add(d.id);
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
          partyMembers.forEach(m => groupUsedIds.delete(m.id));
          break;
        }
      }
    }

    const allGroupParties = [...groupParties, ...noSupportParties].map(p => ({
      ...p,
      rosterSet: undefined,
      avgLevel: p.members.reduce((s, m) => s + m.level, 0) / p.members.length,
      avgPower: p.members.reduce((s, m) => s + powerOf(m), 0) / p.members.length,
    }));

    // 이번 공격대에 파티가 하나도 생성되지 않았으면 종료
    if (allGroupParties.length === 0) break;

    raidGroups.push({ parties: allGroupParties });

    // 이번 공격대에서 쓴 ID를 전체 usedIds에 누적
    groupUsedIds.forEach(id => usedIds.add(id));

    // 무한루프 방지: 파티가 하나라도 생겼지만 완전한 공격대가 안 됐고, 다음에도 못 만들 것 같으면 종료
    // 위에서 이미 "한 파티도 못 만들면 break"이라 충분하지만, 추가 안전장치:
    if (raidGroups.length > 50) break; // 50공격대 이상은 비정상
  }

  // 남은 캐릭터
  const leftoverAll = candidates.filter(c => !usedIds.has(c.id));
  const leftoverDealers = leftoverAll.filter(c => !c.isSupport).sort((a, b) => powerOf(b) - powerOf(a));
  const leftoverSupports = leftoverAll.filter(c => c.isSupport).sort((a, b) => powerOf(b) - powerOf(a));

  return {
    raidGroups,
    leftoverDealers,
    leftoverSupports,
    totalCandidates: candidates.length,
    partiesPerGroup,
  };
}

/**
 * 딜러 목록에서 이 파티에 넣을 수 있는 최상위 딜러를 고른다.
 * - 이미 사용된 딜러 제외
 * - 이미 파티에 같은 원정대 캐릭이 있으면 제외
 * - dealers는 이미 전투력 내림차순 정렬되어 있어야 함
 */
function pickDealerForParty(dealers, usedDealerIds, partyRosterSet) {
  for (const d of dealers) {
    if (usedDealerIds.has(d.id)) continue;
    if (partyRosterSet.has(d.rosterRep)) continue;
    return d;
  }
  return null;
}
