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
  excludedChars: new Set(), // 파티에서 제외할 캐릭터 ID (일시적 제외)
  deletedChars: new Set(),  // 완전히 삭제된 캐릭터 ID (새로고침해도 다시 안 나타남)
  enabledRaids: null,    // 사용자가 직접 체크한 레이드 id Set
  // 수동 공격대: { [raidId]: [{ id, label, parties: [[charId, charId, ...], ...], partyLabels }] }
  manualGroups: {},
  // 자동 공격대/파티 이름 커스터마이즈
  autoLabels: {},
};

// ─── 저장/불러오기 ───
function saveState() {
  const toSave = {
    apiKey: state.apiKey,
    rosters: state.rosters,
    customRaids: state.customRaids,
    raidOverrides: state.raidOverrides,
    excludedChars: Array.from(state.excludedChars),
    deletedChars: Array.from(state.deletedChars),
    enabledRaids: state.enabledRaids ? Array.from(state.enabledRaids) : null,
    manualGroups: state.manualGroups,
    autoLabels: state.autoLabels,
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
    state.deletedChars = new Set(data.deletedChars || []);
    state.enabledRaids = Array.isArray(data.enabledRaids) ? new Set(data.enabledRaids) : null;
    state.manualGroups = data.manualGroups || {};
    state.autoLabels = data.autoLabels || {};
  } catch (e) {
    console.error('불러오기 실패:', e);
  }
}

/**
 * URL 쿼리 파라미터로 전달된 API 키를 localStorage에 저장한다.
 *
 * 지원 형식:
 *   https://example.com/?k=XXX
 *   https://example.com/?key=XXX
 *
 * 보안 처리:
 *  - 저장 후 URL에서 파라미터를 즉시 제거하여 주소창에 노출되지 않도록 함
 *  - history.replaceState로 브라우저 히스토리에 키가 남지 않게 함
 *
 * 반환: 키가 새로 적용되었는지 여부 (토스트 알림용)
 */
function applyApiKeyFromUrl() {
  try {
    const params = new URLSearchParams(window.location.search);
    const keyFromUrl = params.get('k') || params.get('key');
    if (!keyFromUrl) return false;

    // 키 저장
    state.apiKey = keyFromUrl.trim();
    saveState();

    // URL에서 파라미터 제거 (브라우저 히스토리에 남지 않음)
    params.delete('k');
    params.delete('key');
    const newSearch = params.toString();
    const newUrl = window.location.pathname
      + (newSearch ? '?' + newSearch : '')
      + window.location.hash;
    window.history.replaceState({}, document.title, newUrl);

    return true;
  } catch (e) {
    console.error('URL 파라미터 처리 실패:', e);
    return false;
  }
}

// ═══════════════════════════════════════════════════════════
//  스냅샷 공유 기능
// ═══════════════════════════════════════════════════════════
//
// URL 파라미터 ?s=<base64-lz-string>에 현재 파티 편성 상태를 담아서
// 다른 사람에게 "이 시점 그대로" 읽기 전용으로 보여주는 기능.
//
// 스냅샷 구조:
//   {
//     v: 1,                          // 스키마 버전
//     ts: 1234567890,                // 생성 타임스탬프
//     raids: [                        // 스냅샷에 포함된 레이드별 데이터
//       {
//         raidId, raidName, raidMeta,  // 레이드 정보
//         groups: [                     // 공격대(자동+수동 구분 없이 확정된 결과)
//           {
//             isManual, label,
//             parties: [{ label, members: [{id,name,className,level,power,isSupport,rosterRep}, ...] }]
//           }
//         ],
//         leftover: [ { ...char }, ... ]  // 남은 캐릭 (있으면)
//       }
//     ]
//   }
//
// 인코딩:
//  - JSON.stringify → TextEncoder → CompressionStream('gzip') → base64url
//  - 디코딩은 역순
//  - 브라우저 호환성: CompressionStream은 Chrome 80+, Firefox 113+, Safari 16.4+
//    폴백으로 압축 없이 base64만 쓰는 경로도 제공

// 스냅샷 뷰어 모드 플래그
let snapshotMode = null; // null이면 일반 모드, 데이터 있으면 스냅샷 모드

/**
 * 현재 DOM 상태를 읽어서 스냅샷 데이터 객체 생성
 * (자동 공격대의 드래그된 상태까지 정확히 캡쳐)
 */
function createSnapshotData() {
  const raids = [];

  // DOM에서 각 .raid-card를 순회
  document.querySelectorAll('.raid-card').forEach(raidCard => {
    const raidId = raidCard.dataset.raidId;
    if (!raidId) return;
    const raid = getRaidById(raidId);
    const raidName = raidCard.querySelector('.raid-title')?.textContent || raidId;
    const raidRange = raidCard.querySelector('.raid-range')?.textContent || '';

    const groups = [];

    // 공격대(자동+수동) 순회
    raidCard.querySelectorAll('.raid-group').forEach(groupEl => {
      const isManual = groupEl.classList.contains('is-manual');
      const groupLabelInput = groupEl.querySelector('.raid-group-header .editable-label');
      const groupLabel = groupLabelInput?.value || '';

      const parties = [];
      groupEl.querySelectorAll('.party-card').forEach(partyCard => {
        const partyLabelInput = partyCard.querySelector('.party-label .editable-label');
        const partyLabel = partyLabelInput?.value || '';
        const avgPower = partyCard.querySelector('.party-avg-power')?.textContent || '';
        const avgLevel = partyCard.querySelector('.party-avg-level')?.textContent || '';
        const hasWarning = partyCard.classList.contains('no-support');
        const isIncomplete = partyCard.classList.contains('incomplete');

        const members = [];
        partyCard.querySelectorAll('.char-chip').forEach(chip => {
          const charId = chip.dataset.charId;
          const char = findCharById(charId);
          if (char) {
            members.push({
              id: char.id,
              name: char.name,
              className: char.className,
              level: char.level,
              combatPower: char.combatPower,
              isSupport: char.isSupport,
              rosterRep: char.rosterRep,
            });
          }
        });

        if (members.length > 0) {
          parties.push({
            label: partyLabel,
            avgPower,
            avgLevel,
            hasWarning,
            isIncomplete,
            members,
          });
        }
      });

      if (parties.length > 0) {
        groups.push({ isManual, label: groupLabel, parties });
      }
    });

    // 남은 캐릭
    const leftoverZone = raidCard.querySelector('.leftover-zone');
    const leftover = [];
    if (leftoverZone) {
      leftoverZone.querySelectorAll('.char-chip').forEach(chip => {
        const charId = chip.dataset.charId;
        const char = findCharById(charId);
        if (char) {
          leftover.push({
            id: char.id, name: char.name, className: char.className,
            level: char.level, combatPower: char.combatPower,
            isSupport: char.isSupport, rosterRep: char.rosterRep,
          });
        }
      });
    }

    if (groups.length > 0 || leftover.length > 0) {
      raids.push({
        raidId,
        raidName,
        raidRange,
        partySize: raid ? raid.partySize : 8,
        groups,
        leftover,
      });
    }
  });

  return {
    v: 1,
    ts: Date.now(),
    raids,
  };
}

/**
 * 스냅샷 객체 → base64url 문자열 (가능하면 gzip 압축)
 */
async function encodeSnapshot(data) {
  const json = JSON.stringify(data);
  const bytes = new TextEncoder().encode(json);

  // CompressionStream 지원 시 gzip 압축
  if (typeof CompressionStream !== 'undefined') {
    try {
      const stream = new Response(bytes).body.pipeThrough(new CompressionStream('gzip'));
      const compressedBuffer = await new Response(stream).arrayBuffer();
      const compressed = new Uint8Array(compressedBuffer);
      return 'g.' + bytesToBase64Url(compressed);
    } catch (e) {
      console.warn('압축 실패, 비압축 폴백', e);
    }
  }
  return 'r.' + bytesToBase64Url(bytes);
}

/**
 * base64url 문자열 → 스냅샷 객체
 */
async function decodeSnapshot(encoded) {
  if (!encoded) return null;
  const [prefix, ...rest] = encoded.split('.');
  const body = rest.join('.');
  const bytes = base64UrlToBytes(body);

  if (prefix === 'g' && typeof DecompressionStream !== 'undefined') {
    const stream = new Response(bytes).body.pipeThrough(new DecompressionStream('gzip'));
    const buffer = await new Response(stream).arrayBuffer();
    const text = new TextDecoder().decode(buffer);
    return JSON.parse(text);
  } else if (prefix === 'r') {
    const text = new TextDecoder().decode(bytes);
    return JSON.parse(text);
  } else {
    throw new Error('지원되지 않는 스냅샷 형식');
  }
}

// ─── base64url 유틸 ───
function bytesToBase64Url(bytes) {
  let str = '';
  for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function base64UrlToBytes(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const str = atob(s);
  const bytes = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i);
  return bytes;
}

/**
 * URL에 스냅샷이 있는지 확인하고 있으면 파싱하여 반환 (없으면 null)
 * 이 함수는 URL은 건드리지 않음 (스냅샷 모드로 고정되기 때문)
 */
async function loadSnapshotFromUrl() {
  try {
    const params = new URLSearchParams(window.location.search);
    const s = params.get('s') || params.get('snapshot');
    if (!s) return null;
    return await decodeSnapshot(s);
  } catch (e) {
    console.error('스냅샷 로드 실패:', e);
    return null;
  }
}

/**
 * 현재 편성 상태를 URL 문자열로 생성
 */
async function buildSnapshotUrl() {
  const data = createSnapshotData();
  const encoded = await encodeSnapshot(data);
  const base = window.location.origin + window.location.pathname;
  return `${base}?s=${encoded}`;
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

// 디버그용: 마지막 API 응답을 저장해서 콘솔에서 window._debugLastArmory 로 확인 가능
window._debugLastArmory = null;

/**
 * 디버그용: 특정 캐릭터의 armory 전체 응답을 가져와 콘솔에 출력
 * 콘솔에서 직접 호출: await debugCharacter('캐릭명')
 */
window.debugCharacter = async function(characterName) {
  if (!state.apiKey) {
    console.error('API 키가 없습니다.');
    return null;
  }
  const url = `${API_BASE}/armories/characters/${encodeURIComponent(characterName)}`;
  const res = await fetch(url, {
    headers: {
      'accept': 'application/json',
      'authorization': `bearer ${state.apiKey}`,
    },
  });
  if (!res.ok) {
    console.error('API 오류:', res.status);
    return null;
  }
  const data = await res.json();
  console.log('========================================');
  console.log('캐릭터:', characterName);
  console.log('========================================');
  console.log('전체 응답:', data);
  if (data.ArmoryProfile) {
    console.log('\n── ArmoryProfile 전체 ──');
    console.log(data.ArmoryProfile);
    console.log('\n── 숫자 관련 필드 ──');
    const p = data.ArmoryProfile;
    console.log('CharacterClassName:', p.CharacterClassName);
    console.log('ItemAvgLevel:', p.ItemAvgLevel);
    console.log('ItemMaxLevel:', p.ItemMaxLevel);
    console.log('CombatPower:', p.CombatPower);
    console.log('ExpeditionLevel:', p.ExpeditionLevel);
    console.log('CharacterLevel:', p.CharacterLevel);
    if (p.Stats) {
      console.log('\n── Stats (능력치) ──');
      p.Stats.forEach(s => console.log(`  ${s.Type}: ${s.Value}`));
    }
  }
  return data;
};

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
      console.warn(`[전투력] ${characterName}: HTTP ${res.status}`);
      return null;
    }
    // 204 No Content 또는 null 응답 대응
    const text = await res.text();
    if (!text || text.trim() === '' || text.trim() === 'null') {
      console.warn(`[전투력] ${characterName}: 빈 응답 (비공개 캐릭일 수 있음)`);
      return null;
    }
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      console.warn(`[전투력] ${characterName}: JSON 파싱 실패`, text.substring(0, 100));
      return null;
    }
    if (!data || !data.ArmoryProfile) {
      console.warn(`[전투력] ${characterName}: ArmoryProfile 없음`, data);
      return null;
    }

    // 첫 캐릭터 응답은 디버그용으로 저장 (개발자 도구 콘솔에서 확인)
    if (!window._debugLastArmory) {
      window._debugLastArmory = { characterName, response: data };
      console.log('[디버그] 전투력 API 응답 예시 (첫 캐릭):', data.ArmoryProfile);
      console.log('[디버그] CombatPower:', data.ArmoryProfile.CombatPower);
      if (data.ArmoryProfile.Stats) {
        console.log('[디버그] Stats:', data.ArmoryProfile.Stats);
      }
    }

    const cp = data.ArmoryProfile.CombatPower;
    if (cp == null) {
      console.warn(`[전투력] ${characterName}: CombatPower 필드 없음`);
      return null;
    }
    const parsed = parseItemLevel(cp);
    if (parsed === 0) {
      console.warn(`[전투력] ${characterName}: CombatPower 파싱 결과 0`, cp);
    }
    return parsed;
  } catch (e) {
    if (e.message === 'RATE_LIMIT') throw e;
    console.warn(`[전투력] ${characterName}: 네트워크 오류`, e.message);
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
  let chars = normalizeCharacters(siblings, characterName);

  // 삭제된 캐릭은 제외 (사용자가 "삭제" 눌렀던 캐릭)
  chars = chars.filter(c => !state.deletedChars.has(c.id));

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

/**
 * 캐릭터 하나를 완전 삭제. 새로고침해도 다시 안 나타남.
 * 파티/공격대에 들어있었다면 그곳에서도 제거.
 */
function deleteCharacter(charId) {
  // 모든 원정대에서 해당 캐릭 제거
  for (const roster of state.rosters) {
    roster.characters = roster.characters.filter(c => c.id !== charId);
  }
  // 삭제 목록에 추가 (갱신 시 다시 안 불러오기 위함)
  state.deletedChars.add(charId);
  // 일시 제외 목록에서도 제거 (불필요한 중복 방지)
  state.excludedChars.delete(charId);
  // 수동 공격대에 들어있으면 거기서도 제거
  for (const raidId in state.manualGroups) {
    for (const group of state.manualGroups[raidId]) {
      group.parties = group.parties.map(partyIds => partyIds.filter(id => id !== charId));
    }
  }
  saveState();
}

/**
 * 삭제된 캐릭터 목록 복원 (삭제 취소)
 * 전체 삭제 해제. 개별 복원은 별도 구현 안 함 (실제 쓸 일 적음).
 */
function restoreAllDeletedChars() {
  state.deletedChars = new Set();
  saveState();
}

async function refreshRoster(repName) {
  return addRoster(repName);
}

/**
 * 전투력이 0인 캐릭터들만 다시 불러온다.
 * (siblings 재호출 안 함 → 빠름)
 */
async function refreshMissingCombatPower(repName, onProgress) {
  const roster = state.rosters.find(r => r.repName === repName);
  if (!roster) return 0;
  const missing = roster.characters.filter(c => !c.combatPower || c.combatPower === 0);
  let fixed = 0;
  for (let i = 0; i < missing.length; i++) {
    const ch = missing[i];
    if (onProgress) onProgress(i + 1, missing.length, `전투력 재조회: ${ch.name}`);
    try {
      const cp = await fetchCombatPower(ch.name);
      if (cp && cp > 0) {
        ch.combatPower = cp;
        fixed++;
      }
    } catch (e) {
      if (e.message === 'RATE_LIMIT') {
        if (onProgress) onProgress(i + 1, missing.length, '호출 한도 초과, 10초 대기...');
        await sleep(10000);
        try {
          const cp = await fetchCombatPower(ch.name);
          if (cp && cp > 0) { ch.combatPower = cp; fixed++; }
        } catch (_) {}
      }
    }
    if (i < missing.length - 1) await sleep(API_DELAY_MS);
  }
  saveState();
  return fixed;
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
 *  (5) 공팟 고려: 파티에 못 끼는 캐릭은 레벨 높은 애가 남도록 우선순위 조정
 *      → 하위 캐릭부터 파티에 넣음. 고스펙 캐릭은 공팟에서 빠르게 팟을 잡을 수 있음.
 *
 * 공격대(raidGroup) 단위:
 *  - 4인 레이드(partySize=4): 1공격대 = 파티 1개
 *  - 8인 레이드(partySize=8): 1공격대 = 파티 2개
 *
 * 알고리즘:
 *  1) 총 공격대 수와 필요 서포터/딜러 수를 미리 계산
 *  2) 서포터는 하위 레벨부터 필요한 만큼만 선발 (상위는 공팟용으로 남김)
 *  3) 딜러도 하위 레벨부터 선발
 *  4) 선발된 인원 내에서 snake-draft로 파티별 평균 균등화
 *  5) 원정대 중복 제약으로 인해 재선발이 필요한 경우 상위 캐릭 하나씩 추가
 *
 * 전투력 0인 캐릭터 처리:
 *  - 전투력 못 받아온 캐릭은 아이템 레벨 * 2 를 임시값으로 사용
 */
function buildParties(raid) {
  const allChars = getAllCharacters();
  const candidates = allChars.filter(c =>
    c.level >= raid.minLevel && c.level < raid.maxLevel
  );

  // 전투력 없으면 템레벨 기반 임시값 사용
  const powerOf = (c) => c.combatPower > 0 ? c.combatPower : c.level * 2;

  const partySize = raid.partySize || 8;
  const partiesPerGroup = Math.max(1, Math.floor(partySize / 4));

  // ─── 사전 계산: 이론적으로 만들 수 있는 최대 공격대 수 ───
  // (원정대 중복 제약은 나중에 반영되지만 일단 상한 산정)
  const allDealers = candidates.filter(c => !c.isSupport);
  const allSupports = candidates.filter(c => c.isSupport);
  const maxGroupsByDealers = Math.floor(allDealers.length / (3 * partiesPerGroup));
  const maxGroupsBySupports = Math.floor(allSupports.length / partiesPerGroup);
  // 서포터 부족 파티(딜러 4명)도 허용 → 딜러만으로도 공격대 구성 가능한 경우까지 고려
  const maxGroupsByDealersAlone = Math.floor(allDealers.length / (4 * partiesPerGroup));
  const targetGroupCount = Math.max(
    Math.min(maxGroupsByDealers, maxGroupsBySupports), // 서포터 풀 파티 최대치
    maxGroupsByDealersAlone // 딜러만의 공격대도 만들 수 있으면
  );

  // ─── 하위 캐릭부터 선발 (공팟 상위 캐릭 남기기) ───
  // 필요 인원 수
  const neededSupports = Math.min(allSupports.length, targetGroupCount * partiesPerGroup);
  const neededDealers = targetGroupCount * partiesPerGroup * 3
    + Math.max(0, (targetGroupCount * partiesPerGroup - neededSupports)) * 1;
    // 서포터 부족 파티는 딜러 4명 → 부족한 서포터 수만큼 딜러 1명 추가 필요
  const neededDealersCapped = Math.min(allDealers.length, neededDealers);

  // 하위 전투력부터 정렬
  const sortedSupportsAsc = [...allSupports].sort((a, b) => powerOf(a) - powerOf(b));
  const sortedDealersAsc = [...allDealers].sort((a, b) => powerOf(a) - powerOf(b));
  const selectedSupports = sortedSupportsAsc.slice(0, neededSupports);
  const selectedDealers = sortedDealersAsc.slice(0, neededDealersCapped);

  // 선발된 풀 (공격대 구성 대상)
  let poolSupports = [...selectedSupports];
  let poolDealers = [...selectedDealers];

  // 원정대 중복 제약으로 배정 불가 시 상위 캐릭을 추가로 당겨오기 위한 '예비 풀'
  const reserveSupports = sortedSupportsAsc.slice(neededSupports);
  const reserveDealers = sortedDealersAsc.slice(neededDealersCapped);

  // ─── 공격대 구성 ───
  const raidGroups = [];
  const usedIds = new Set();

  for (let g = 0; g < targetGroupCount + 5; g++) { // 안전장치 +5
    // 현재 풀에서 미사용 인원
    const poolRemDealers = poolDealers
      .filter(c => !usedIds.has(c.id))
      .sort((a, b) => powerOf(b) - powerOf(a)); // 공격대 내부 분배는 내림차순
    const poolRemSupports = poolSupports
      .filter(c => !usedIds.has(c.id))
      .sort((a, b) => powerOf(b) - powerOf(a));

    const groupParties = [];
    const groupUsedIds = new Set();

    // 1) 서포터 배치
    for (let i = 0; i < partiesPerGroup; i++) {
      const picked = poolRemSupports.find(s => !groupUsedIds.has(s.id));
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

    // 2) 딜러 snake-draft (원정대 중복 금지)
    if (groupParties.length > 0) {
      const n = groupParties.length;
      let direction = 1, idx = 0;
      for (let round = 0; round < 10; round++) {
        let assignedInRound = 0;
        for (let step = 0; step < n; step++) {
          const party = groupParties[idx];
          if (party.dealers.length < 3) {
            // 풀에서 먼저 찾기
            let picked = pickDealerForParty(poolRemDealers, groupUsedIds, party.rosterSet);
            // 풀에서 못 찾으면 예비 풀(상위 캐릭)에서 당겨오기
            if (!picked && reserveDealers.length > 0) {
              const reservePicked = pickDealerForParty(
                reserveDealers.filter(c => !usedIds.has(c.id) && !groupUsedIds.has(c.id)),
                new Set(),
                party.rosterSet
              );
              if (reservePicked) {
                // 예비에서 풀로 이동
                const idxInReserve = reserveDealers.indexOf(reservePicked);
                if (idxInReserve >= 0) reserveDealers.splice(idxInReserve, 1);
                poolDealers.push(reservePicked);
                poolRemDealers.push(reservePicked); // 이번 라운드에서도 사용 가능
                picked = reservePicked;
              }
            }
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
      }
    }

    // 3) 서포터 부족 파티 (딜러 4명)
    const noSupportParties = [];
    if (supportShort > 0) {
      for (let p = 0; p < supportShort; p++) {
        const partyRosters = new Set();
        const partyMembers = [];
        // 풀 + 예비에서 순차적으로 시도
        const candidatePool = [
          ...poolDealers.filter(c => !usedIds.has(c.id) && !groupUsedIds.has(c.id)),
          ...reserveDealers.filter(c => !usedIds.has(c.id) && !groupUsedIds.has(c.id))
        ].sort((a, b) => powerOf(a) - powerOf(b)); // 하위 우선
        for (const d of candidatePool) {
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

    if (allGroupParties.length === 0) break;

    raidGroups.push({ parties: allGroupParties });
    groupUsedIds.forEach(id => usedIds.add(id));

    if (raidGroups.length > 50) break;
  }

  // 남은 캐릭터 (예비 풀에서 아직 안 쓴 것 포함)
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

// ─── 수동 공격대 관리 ───

/**
 * 캐릭터 ID로 캐릭터 객체 찾기
 */
function findCharById(id) {
  for (const roster of state.rosters) {
    for (const ch of roster.characters) {
      if (ch.id === id) return ch;
    }
  }
  return null;
}

/**
 * 수동 공격대 추가
 */
function addManualGroup(raidId) {
  if (!state.manualGroups[raidId]) state.manualGroups[raidId] = [];
  const raid = getRaidById(raidId);
  const partiesPerGroup = raid ? Math.max(1, Math.floor((raid.partySize || 8) / 4)) : 2;
  const newGroup = {
    id: 'mg_' + Date.now(),
    label: `내 공격대 ${state.manualGroups[raidId].length + 1}`,
    parties: Array.from({ length: partiesPerGroup }, () => []),
  };
  state.manualGroups[raidId].push(newGroup);
  saveState();
  return newGroup;
}

/**
 * 수동 공격대 삭제
 */
function removeManualGroup(raidId, groupId) {
  if (!state.manualGroups[raidId]) return;
  state.manualGroups[raidId] = state.manualGroups[raidId].filter(g => g.id !== groupId);
  if (state.manualGroups[raidId].length === 0) delete state.manualGroups[raidId];
  saveState();
}

/**
 * 수동 공격대에 빈 파티 추가
 */
function addEmptyPartyToManualGroup(raidId, groupId) {
  const group = (state.manualGroups[raidId] || []).find(g => g.id === groupId);
  if (!group) return;
  group.parties.push([]);
  saveState();
}

/**
 * 수동 공격대의 특정 파티 삭제 (캐릭들은 빠지고 파티 자체 제거)
 */
function removePartyFromManualGroup(raidId, groupId, partyIdx) {
  const group = (state.manualGroups[raidId] || []).find(g => g.id === groupId);
  if (!group) return;
  group.parties.splice(partyIdx, 1);
  if (group.parties.length === 0) {
    // 빈 공격대면 공격대 자체도 제거
    removeManualGroup(raidId, groupId);
  } else {
    saveState();
  }
}

/**
 * 수동 공격대의 파티 멤버 업데이트 (드래그 결과 반영)
 */
function updateManualPartyMembers(raidId, groupId, partyIdx, charIds) {
  const group = (state.manualGroups[raidId] || []).find(g => g.id === groupId);
  if (!group) return;
  if (!group.parties[partyIdx]) group.parties[partyIdx] = [];
  group.parties[partyIdx] = charIds;
  saveState();
}

/**
 * 수동 공격대 라벨 변경
 */
function renameManualGroup(raidId, groupId, newLabel) {
  const group = (state.manualGroups[raidId] || []).find(g => g.id === groupId);
  if (!group) return;
  group.label = newLabel;
  saveState();
}

/**
 * 수동 공격대에 캐릭터 객체들을 담아서 돌려준다. (렌더링용)
 */
function getManualGroupsForRaid(raidId) {
  const raw = state.manualGroups[raidId] || [];
  return raw.map(g => ({
    id: g.id,
    label: g.label,
    partyLabels: g.partyLabels || {},
    parties: g.parties.map(memberIds => {
      const members = memberIds.map(id => findCharById(id)).filter(Boolean);
      const powerOf = (c) => c.combatPower > 0 ? c.combatPower : c.level * 2;
      const hasSupport = members.some(m => m.isSupport);
      return {
        members,
        hasSupport,
        support: members.find(m => m.isSupport) || null,
        dealers: members.filter(m => !m.isSupport),
        avgLevel: members.length > 0 ? members.reduce((s, m) => s + m.level, 0) / members.length : 0,
        avgPower: members.length > 0 ? members.reduce((s, m) => s + powerOf(m), 0) / members.length : 0,
      };
    }),
  }));
}

// ─── 자동 공격대/파티 이름 커스터마이즈 ───
function getAutoGroupLabel(raidId, groupIdx, fallback) {
  const labels = state.autoLabels[raidId];
  if (labels && labels.groups && labels.groups[groupIdx]) {
    return labels.groups[groupIdx];
  }
  return fallback;
}

function getAutoPartyLabel(raidId, groupIdx, partyIdx, fallback) {
  const labels = state.autoLabels[raidId];
  const key = `${groupIdx}_${partyIdx}`;
  if (labels && labels.parties && labels.parties[key]) {
    return labels.parties[key];
  }
  return fallback;
}

function setAutoGroupLabel(raidId, groupIdx, label) {
  if (!state.autoLabels[raidId]) state.autoLabels[raidId] = { groups: {}, parties: {} };
  if (!state.autoLabels[raidId].groups) state.autoLabels[raidId].groups = {};
  if (label && label.trim()) {
    state.autoLabels[raidId].groups[groupIdx] = label.trim();
  } else {
    delete state.autoLabels[raidId].groups[groupIdx];
  }
  saveState();
}

function setAutoPartyLabel(raidId, groupIdx, partyIdx, label) {
  if (!state.autoLabels[raidId]) state.autoLabels[raidId] = { groups: {}, parties: {} };
  if (!state.autoLabels[raidId].parties) state.autoLabels[raidId].parties = {};
  const key = `${groupIdx}_${partyIdx}`;
  if (label && label.trim()) {
    state.autoLabels[raidId].parties[key] = label.trim();
  } else {
    delete state.autoLabels[raidId].parties[key];
  }
  saveState();
}

// 수동 공격대의 개별 파티 이름
function setManualPartyLabel(raidId, groupId, partyIdx, label) {
  const group = (state.manualGroups[raidId] || []).find(g => g.id === groupId);
  if (!group) return;
  if (!group.partyLabels) group.partyLabels = {};
  if (label && label.trim()) {
    group.partyLabels[partyIdx] = label.trim();
  } else {
    delete group.partyLabels[partyIdx];
  }
  saveState();
}
