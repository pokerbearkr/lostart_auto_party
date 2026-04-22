/**
 * 메인 앱 - UI 렌더링 및 드래그 앤 드롭 처리
 * SortableJS를 사용해 파티 간 드래그 가능하도록 구현
 */

// DOM 캐시
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// ─── 초기화 ───
window.addEventListener('DOMContentLoaded', () => {
  loadState();
  initEventListeners();
  renderAll();
});

function initEventListeners() {
  // API 키 저장
  $('#api-key-save').addEventListener('click', () => {
    const val = $('#api-key-input').value.trim();
    if (!val) {
      alert('API 키를 입력해주세요.');
      return;
    }
    state.apiKey = val;
    saveState();
    renderApiKeyStatus();
    showToast('API 키가 저장되었습니다.');
  });

  // 원정대 추가
  $('#add-roster-btn').addEventListener('click', async () => {
    const input = $('#roster-name-input');
    const name = input.value.trim();
    if (!name) { alert('캐릭터명을 입력해주세요.'); return; }
    const btn = $('#add-roster-btn');
    btn.disabled = true;
    btn.textContent = '불러오는 중...';
    try {
      await addRoster(name);
      input.value = '';
      renderRosters();
      renderRaids();
      showToast(`'${name}' 원정대가 추가되었습니다.`);
    } catch (e) {
      alert(e.message);
    } finally {
      btn.disabled = false;
      btn.textContent = '원정대 추가';
    }
  });

  $('#roster-name-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('#add-roster-btn').click();
  });

  // 전체 새로고침
  $('#refresh-all-btn').addEventListener('click', async () => {
    const btn = $('#refresh-all-btn');
    btn.disabled = true;
    btn.textContent = '새로고침 중...';
    try {
      for (const r of [...state.rosters]) {
        await refreshRoster(r.repName);
      }
      renderRosters();
      renderRaids();
      showToast('모든 원정대가 갱신되었습니다.');
    } catch (e) {
      alert('갱신 중 오류: ' + e.message);
    } finally {
      btn.disabled = false;
      btn.textContent = '전체 새로고침';
    }
  });

  // 데이터 초기화
  $('#clear-all-btn').addEventListener('click', () => {
    if (!confirm('모든 데이터를 초기화하시겠습니까? (API 키 포함)')) return;
    localStorage.removeItem(LS_KEY);
    state.apiKey = '';
    state.rosters = [];
    state.customRaids = [];
    state.raidOverrides = {};
    state.assignments = {};
    state.excludedChars = new Set();
    renderAll();
    showToast('초기화되었습니다.');
  });

  // 커스텀 레이드 추가
  $('#add-custom-raid-btn').addEventListener('click', () => {
    const name = $('#custom-raid-name').value.trim();
    const min = parseFloat($('#custom-raid-min').value);
    const max = parseFloat($('#custom-raid-max').value);
    if (!name || !min || !max || max <= min) {
      alert('레이드명/최소레벨/최대레벨을 올바르게 입력해주세요.');
      return;
    }
    const id = 'custom_' + Date.now();
    state.customRaids.push({
      id, name, category: '커스텀',
      minLevel: min, maxLevel: max,
      partySize: 8, supportsPerParty: 1,
    });
    saveState();
    $('#custom-raid-name').value = '';
    $('#custom-raid-min').value = '';
    $('#custom-raid-max').value = '';
    renderRaids();
  });
}

// ─── 렌더링 ───
function renderAll() {
  renderApiKeyStatus();
  renderRosters();
  renderRaids();
}

function renderApiKeyStatus() {
  const statusEl = $('#api-key-status');
  if (state.apiKey) {
    statusEl.textContent = `● 저장됨 (${state.apiKey.substring(0, 8)}...)`;
    statusEl.className = 'api-status saved';
    $('#api-key-input').value = state.apiKey;
  } else {
    statusEl.textContent = '○ API 키 미설정';
    statusEl.className = 'api-status empty';
  }
}

function renderRosters() {
  const container = $('#rosters-list');
  if (state.rosters.length === 0) {
    container.innerHTML = '<p class="empty-msg">등록된 원정대가 없습니다. 위에서 캐릭터명을 입력해 추가해주세요.</p>';
    return;
  }

  container.innerHTML = state.rosters.map(r => {
    const chars = r.characters
      .slice()
      .sort((a, b) => b.level - a.level);
    const charRows = chars.map(c => {
      const excluded = state.excludedChars.has(c.id);
      return `
        <tr class="${excluded ? 'excluded' : ''}">
          <td class="name-cell">${c.name}</td>
          <td class="class-cell ${c.isSupport ? 'is-support' : ''}">${c.className}</td>
          <td class="level-cell">${c.level.toFixed(2)}</td>
          <td class="exclude-cell">
            <label><input type="checkbox" data-char-id="${c.id}" class="exclude-checkbox" ${excluded ? 'checked' : ''}> 제외</label>
          </td>
        </tr>`;
    }).join('');
    const supCount = chars.filter(c => c.isSupport && !state.excludedChars.has(c.id)).length;
    const dpsCount = chars.filter(c => !c.isSupport && !state.excludedChars.has(c.id)).length;
    return `
      <div class="roster-card">
        <div class="roster-header">
          <h3>${r.repName} <span class="roster-counts">딜 ${dpsCount} · 폿 ${supCount}</span></h3>
          <div class="roster-actions">
            <button class="btn-sm" data-refresh="${r.repName}">갱신</button>
            <button class="btn-sm btn-danger" data-remove="${r.repName}">삭제</button>
          </div>
        </div>
        <table class="char-table">
          <thead>
            <tr><th>캐릭명</th><th>직업</th><th>템렙</th><th></th></tr>
          </thead>
          <tbody>${charRows}</tbody>
        </table>
      </div>
    `;
  }).join('');

  // 이벤트 바인딩
  container.querySelectorAll('[data-refresh]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const name = btn.dataset.refresh;
      btn.disabled = true;
      btn.textContent = '...';
      try {
        await refreshRoster(name);
        renderRosters();
        renderRaids();
      } catch (e) {
        alert(e.message);
      }
    });
  });
  container.querySelectorAll('[data-remove]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!confirm(`'${btn.dataset.remove}' 원정대를 삭제하시겠습니까?`)) return;
      removeRoster(btn.dataset.remove);
      renderRosters();
      renderRaids();
    });
  });
  container.querySelectorAll('.exclude-checkbox').forEach(cb => {
    cb.addEventListener('change', () => {
      const id = cb.dataset.charId;
      if (cb.checked) state.excludedChars.add(id);
      else state.excludedChars.delete(id);
      saveState();
      renderRosters();
      renderRaids();
    });
  });
}

// 전역: 캐릭터별로 "어느 레이드들에 배정돼있는지"를 매 렌더마다 계산해서 저장
// { charId: [raidName1, raidName2, ...] }
let charAssignmentMap = {};

function renderRaids() {
  const container = $('#raids-list');
  const raids = getAllRaids();

  // 해당하는 캐릭터가 한 명이라도 있는 레이드만 표시 + 전부 표시 토글
  const showAll = $('#show-all-raids')?.checked ?? false;

  const raidsWithData = raids.map(raid => {
    const result = buildParties(raid);
    return { raid, result };
  }).filter(({ result }) => showAll || result.totalCandidates > 0);

  if (raidsWithData.length === 0) {
    container.innerHTML = '<p class="empty-msg">매칭 가능한 캐릭터가 없습니다. 원정대를 먼저 추가해주세요.</p>';
    return;
  }

  // ─── 중복 배정 집계 ───
  // 파티(정식 배정)에 들어간 캐릭만 카운트. "남은 캐릭터" 영역은 숙제 후보가 아니므로 제외.
  charAssignmentMap = {};
  for (const { raid, result } of raidsWithData) {
    for (const party of result.parties) {
      for (const member of party.members) {
        if (!charAssignmentMap[member.id]) charAssignmentMap[member.id] = [];
        charAssignmentMap[member.id].push(raid.name);
      }
    }
  }

  // 카테고리별 그룹핑
  const byCategory = {};
  for (const item of raidsWithData) {
    const cat = item.raid.category || '기타';
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(item);
  }

  container.innerHTML = Object.entries(byCategory).map(([cat, items]) => `
    <section class="raid-category">
      <h2 class="category-title">${cat}</h2>
      ${items.map(({ raid, result }) => renderRaidCard(raid, result)).join('')}
    </section>
  `).join('');

  // 드래그 앤 드롭 초기화
  initDragAndDrop();

  // 레이드 편집 버튼
  container.querySelectorAll('[data-edit-raid]').forEach(btn => {
    btn.addEventListener('click', () => editRaidLevels(btn.dataset.editRaid));
  });
  container.querySelectorAll('[data-delete-raid]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!confirm('이 커스텀 레이드를 삭제하시겠습니까?')) return;
      state.customRaids = state.customRaids.filter(r => r.id !== btn.dataset.deleteRaid);
      saveState();
      renderRaids();
    });
  });
  container.querySelectorAll('[data-reassign]').forEach(btn => {
    btn.addEventListener('click', () => {
      // 해당 레이드의 수동 할당 초기화 (자동 재배치)
      delete state.assignments[btn.dataset.reassign];
      saveState();
      renderRaids();
    });
  });
}

function renderRaidCard(raid, result) {
  const { parties, leftoverDealers, leftoverSupports, totalCandidates } = result;

  const partiesHtml = parties.map((party, i) => {
    const membersHtml = party.members.map(m => renderCharChip(m)).join('');
    const avgDisplay = party.avgLevel.toFixed(2);
    const warningHtml = !party.hasSupport
      ? '<div class="party-warning">⚠ 서포터 부족</div>' : '';
    return `
      <div class="party-card ${!party.hasSupport ? 'no-support' : ''}">
        <div class="party-header">
          <span class="party-label">파티 ${i + 1}</span>
          <span class="party-avg">평균 ${avgDisplay}</span>
        </div>
        ${warningHtml}
        <div class="party-members drop-zone" data-raid-id="${raid.id}" data-party-index="${i}">
          ${membersHtml}
        </div>
      </div>
    `;
  }).join('');

  const leftoverHtml = (leftoverDealers.length > 0 || leftoverSupports.length > 0) ? `
    <div class="leftover-section">
      <h4 class="leftover-title">남은 캐릭터 <span class="hint">(드래그해서 파티로 이동 가능)</span></h4>
      <div class="party-members drop-zone leftover-zone" data-raid-id="${raid.id}" data-party-index="leftover">
        ${[...leftoverSupports, ...leftoverDealers].map(m => renderCharChip(m)).join('')}
      </div>
    </div>
  ` : '';

  const isCustom = raid.category === '커스텀';
  const overrideNotice = state.raidOverrides[raid.id] ? ' (수정됨)' : '';

  return `
    <article class="raid-card">
      <header class="raid-header">
        <div class="raid-title-group">
          <h3 class="raid-title">${raid.name}</h3>
          <span class="raid-range">${raid.minLevel} ~ ${raid.maxLevel - 0.01}${overrideNotice}</span>
        </div>
        <div class="raid-meta">
          <span class="raid-count">후보 ${totalCandidates}명 · 파티 ${parties.length}개</span>
          <button class="btn-xs" data-edit-raid="${raid.id}">레벨수정</button>
          <button class="btn-xs" data-reassign="${raid.id}">재배치</button>
          ${isCustom ? `<button class="btn-xs btn-danger" data-delete-raid="${raid.id}">삭제</button>` : ''}
        </div>
      </header>
      ${parties.length > 0
        ? `<div class="parties-grid">${partiesHtml}</div>`
        : '<p class="empty-msg-small">매칭 가능한 파티가 없습니다.</p>'}
      ${leftoverHtml}
    </article>
  `;
}

function renderCharChip(char) {
  const supportClass = char.isSupport ? 'support' : 'dealer';
  // 이 캐릭이 여러 레이드 파티에 동시 배정되어있는지 확인
  const assignedRaids = charAssignmentMap[char.id] || [];
  const dupCount = assignedRaids.length;
  const isDup = dupCount >= 2;
  const badge = isDup
    ? `<span class="chip-dup-badge" title="${assignedRaids.join(', ')}">×${dupCount}</span>`
    : '';
  const tooltipTitle = isDup
    ? `이 캐릭터는 ${dupCount}개 레이드에 배정됨:\n- ${assignedRaids.join('\n- ')}`
    : '';
  return `
    <div class="char-chip ${supportClass} ${isDup ? 'is-duplicate' : ''}"
         draggable="true"
         data-char-id="${char.id}"
         data-char-level="${char.level}"
         data-is-support="${char.isSupport}"
         ${tooltipTitle ? `title="${tooltipTitle}"` : ''}>
      <span class="chip-name">${char.name}${badge}</span>
      <span class="chip-class">${char.className}</span>
      <span class="chip-level">${char.level.toFixed(2)}</span>
    </div>
  `;
}

// ─── 드래그 앤 드롭 ───
function initDragAndDrop() {
  const zones = $$('.drop-zone');
  zones.forEach(zone => {
    // SortableJS 초기화 - 같은 레이드 내 파티끼리 그룹화
    const raidId = zone.dataset.raidId;
    Sortable.create(zone, {
      group: `raid_${raidId}`,
      animation: 150,
      ghostClass: 'chip-ghost',
      chosenClass: 'chip-chosen',
      dragClass: 'chip-drag',
      onEnd: (evt) => handleDragEnd(evt, raidId),
    });
  });
}

function handleDragEnd(evt, raidId) {
  // 드래그 후 실제 DOM 배치가 이미 바뀐 상태
  // 각 파티의 평균을 재계산하여 UI 업데이트
  const raidCard = evt.to.closest('.raid-card');
  if (!raidCard) return;

  // 모든 drop-zone (파티 + leftover) 에서 chip을 읽어 평균 업데이트
  const zones = raidCard.querySelectorAll('.party-members');
  zones.forEach(zone => {
    const chips = zone.querySelectorAll('.char-chip');
    const partyCard = zone.closest('.party-card');
    if (!partyCard) return; // leftover-zone은 제외

    let sum = 0, cnt = 0;
    let hasSupport = false;
    chips.forEach(chip => {
      sum += parseFloat(chip.dataset.charLevel);
      cnt++;
      if (chip.dataset.isSupport === 'true') hasSupport = true;
    });
    const avg = cnt > 0 ? sum / cnt : 0;
    const avgEl = partyCard.querySelector('.party-avg');
    if (avgEl) avgEl.textContent = `평균 ${avg.toFixed(2)}`;

    // 서포터 부족 경고 업데이트
    partyCard.classList.toggle('no-support', !hasSupport && cnt > 0);
    const warningEl = partyCard.querySelector('.party-warning');
    if (!hasSupport && cnt > 0 && !warningEl) {
      const header = partyCard.querySelector('.party-header');
      const warn = document.createElement('div');
      warn.className = 'party-warning';
      warn.textContent = '⚠ 서포터 부족';
      header.after(warn);
    } else if (hasSupport && warningEl) {
      warningEl.remove();
    }
  });

  // ─── 중복 배정 배지 재계산 ───
  // 드래그로 배치가 바뀌었으므로 전체 문서를 스캔하여 카운트 갱신
  updateDuplicateBadges();
}

/**
 * 현재 DOM 상태를 기준으로 모든 칩의 중복 배정 배지를 다시 계산하여 업데이트한다.
 * (파티 영역에 있는 칩만 카운트. 남은 캐릭터 영역은 제외.)
 */
function updateDuplicateBadges() {
  // 1. 캐릭터별로 현재 들어있는 레이드 목록 수집
  const map = {}; // { charId: [raidName, ...] }
  document.querySelectorAll('.raid-card').forEach(raidCard => {
    const raidTitleEl = raidCard.querySelector('.raid-title');
    const raidName = raidTitleEl ? raidTitleEl.textContent : '';
    // 파티 내부의 칩만 수집 (leftover-zone 제외)
    raidCard.querySelectorAll('.party-card .char-chip').forEach(chip => {
      const id = chip.dataset.charId;
      if (!map[id]) map[id] = [];
      map[id].push(raidName);
    });
  });
  // 전역 맵도 갱신 (다음 렌더 시 일관성 유지)
  charAssignmentMap = map;

  // 2. 모든 칩에 대해 배지 업데이트 (파티 내부 + 남은 캐릭터 영역 모두)
  document.querySelectorAll('.char-chip').forEach(chip => {
    const id = chip.dataset.charId;
    const raids = map[id] || [];
    const dupCount = raids.length;
    const isDup = dupCount >= 2;

    chip.classList.toggle('is-duplicate', isDup);

    // 기존 배지 제거
    const oldBadge = chip.querySelector('.chip-dup-badge');
    if (oldBadge) oldBadge.remove();

    // 새 배지 추가
    if (isDup) {
      const nameEl = chip.querySelector('.chip-name');
      if (nameEl) {
        const badge = document.createElement('span');
        badge.className = 'chip-dup-badge';
        badge.title = raids.join(', ');
        badge.textContent = `×${dupCount}`;
        nameEl.appendChild(badge);
      }
      chip.title = `이 캐릭터는 ${dupCount}개 레이드에 배정됨:\n- ${raids.join('\n- ')}`;
    } else {
      chip.removeAttribute('title');
    }
  });
}

// ─── 레이드 레벨 수정 모달 ───
function editRaidLevels(raidId) {
  const raid = getRaidById(raidId);
  if (!raid) return;
  const newMin = prompt(`${raid.name}의 최소 아이템레벨:`, raid.minLevel);
  if (newMin === null) return;
  const newMax = prompt(`${raid.name}의 상한 아이템레벨 (이 값 미만까지만 매칭):`, raid.maxLevel);
  if (newMax === null) return;
  const min = parseFloat(newMin);
  const max = parseFloat(newMax);
  if (isNaN(min) || isNaN(max) || max <= min) {
    alert('올바르지 않은 값입니다.');
    return;
  }
  if (raid.category === '커스텀') {
    const idx = state.customRaids.findIndex(r => r.id === raidId);
    if (idx >= 0) {
      state.customRaids[idx].minLevel = min;
      state.customRaids[idx].maxLevel = max;
    }
  } else {
    state.raidOverrides[raidId] = { minLevel: min, maxLevel: max };
  }
  saveState();
  renderRaids();
}

// ─── 토스트 알림 ───
function showToast(msg) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.classList.add('show'), 10);
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 2500);
}
