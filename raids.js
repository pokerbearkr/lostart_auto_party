/**
 * 메인 앱 - UI 렌더링 및 인터랙션
 * - 원정대 목록 관리
 * - 레이드 선택 체크박스 (원하는 레이드만 파티 편성)
 * - 파티 자동 편성 (원정대 중복 방지)
 * - 드래그 앤 드롭 (다른 파티로 이동 시 경고 포함)
 */

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// 중복 배정 집계 (캐릭ID → [레이드명])
let charAssignmentMap = {};

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
    if (!val) { alert('API 키를 입력해주세요.'); return; }
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
    state.excludedChars = new Set();
    state.enabledRaids = null;
    renderAll();
    showToast('초기화되었습니다.');
  });

  // 커스텀 레이드 추가
  $('#add-custom-raid-btn').addEventListener('click', () => {
    const name = $('#custom-raid-name').value.trim();
    const min = parseFloat($('#custom-raid-min').value);
    const max = parseFloat($('#custom-raid-max').value);
    const size = parseInt($('#custom-raid-size').value, 10) || 8;
    if (!name || !min || !max || max <= min) {
      alert('레이드명/최소레벨/최대레벨을 올바르게 입력해주세요.');
      return;
    }
    const id = 'custom_' + Date.now();
    state.customRaids.push({
      id, name, category: '커스텀',
      minLevel: min, maxLevel: max,
      partySize: size, supportsPerParty: 1,
      defaultEnabled: true,
    });
    // 새 레이드는 자동 활성화
    if (state.enabledRaids !== null) state.enabledRaids.add(id);
    saveState();
    $('#custom-raid-name').value = '';
    $('#custom-raid-min').value = '';
    $('#custom-raid-max').value = '';
    renderRaidSelector();
    renderRaids();
  });
}

// ─── 렌더링 ───
function renderAll() {
  renderApiKeyStatus();
  renderRosters();
  renderRaidSelector();
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
    const chars = r.characters.slice().sort((a, b) => b.level - a.level);
    const charRows = chars.map(c => {
      const excluded = state.excludedChars.has(c.id);
      return `
        <tr class="${excluded ? 'excluded' : ''}">
          <td class="name-cell">${escapeHtml(c.name)}</td>
          <td class="class-cell ${c.isSupport ? 'is-support' : ''}">${escapeHtml(c.className)}</td>
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
          <h3>${escapeHtml(r.repName)} <span class="roster-counts">딜 ${dpsCount} · 폿 ${supCount}</span></h3>
          <div class="roster-actions">
            <button class="btn-sm" data-refresh="${escapeHtml(r.repName)}">갱신</button>
            <button class="btn-sm btn-danger" data-remove="${escapeHtml(r.repName)}">삭제</button>
          </div>
        </div>
        <table class="char-table">
          <thead><tr><th>캐릭명</th><th>직업</th><th>템렙</th><th></th></tr></thead>
          <tbody>${charRows}</tbody>
        </table>
      </div>
    `;
  }).join('');

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

// ─── 레이드 선택 체크박스 ───
function renderRaidSelector() {
  const container = $('#raid-selector');
  const raids = getAllRaids();

  // 카테고리별 그룹핑
  const byCategory = {};
  for (const r of raids) {
    const cat = r.category || '기타';
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(r);
  }

  container.innerHTML = Object.entries(byCategory).map(([cat, items]) => `
    <div class="raid-sel-group">
      <div class="raid-sel-group-title">
        <span>${escapeHtml(cat)}</span>
        <button class="btn-xs btn-ghost" data-sel-cat="${escapeHtml(cat)}" data-sel-action="on">전체</button>
        <button class="btn-xs btn-ghost" data-sel-cat="${escapeHtml(cat)}" data-sel-action="off">해제</button>
      </div>
      <div class="raid-sel-items">
        ${items.map(r => {
          const enabled = isRaidEnabled(r);
          return `
            <label class="raid-sel-item ${enabled ? 'on' : ''}">
              <input type="checkbox" data-raid-id="${r.id}" class="raid-sel-check" ${enabled ? 'checked' : ''}>
              <span class="raid-sel-name">${escapeHtml(r.name)}</span>
              <span class="raid-sel-meta">${r.partySize}인 · ${r.minLevel}~${(r.maxLevel - 0.01).toFixed(0)}</span>
            </label>
          `;
        }).join('')}
      </div>
    </div>
  `).join('');

  // 개별 체크박스 이벤트
  container.querySelectorAll('.raid-sel-check').forEach(cb => {
    cb.addEventListener('change', () => {
      toggleRaidEnabled(cb.dataset.raidId, cb.checked);
      cb.closest('.raid-sel-item').classList.toggle('on', cb.checked);
      renderRaids();
    });
  });

  // 카테고리 전체/해제 버튼
  container.querySelectorAll('[data-sel-cat]').forEach(btn => {
    btn.addEventListener('click', () => {
      const cat = btn.dataset.selCat;
      const action = btn.dataset.selAction === 'on';
      for (const r of raids) {
        if ((r.category || '기타') === cat) {
          toggleRaidEnabled(r.id, action);
        }
      }
      renderRaidSelector();
      renderRaids();
    });
  });
}

// ─── 메인 파티 편성 영역 ───
function renderRaids() {
  const container = $('#raids-list');
  const raids = getAllRaids().filter(r => isRaidEnabled(r));

  if (raids.length === 0) {
    container.innerHTML = '<p class="empty-msg">선택된 레이드가 없습니다. 왼쪽에서 파티를 짤 레이드를 체크해주세요.</p>';
    return;
  }

  const raidsWithData = raids.map(raid => ({
    raid,
    result: buildParties(raid),
  }));

  // 중복 배정 집계 (파티에 실제로 들어간 캐릭만)
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
      <h2 class="category-title">${escapeHtml(cat)}</h2>
      ${items.map(({ raid, result }) => renderRaidCard(raid, result)).join('')}
    </section>
  `).join('');

  initDragAndDrop();

  container.querySelectorAll('[data-edit-raid]').forEach(btn => {
    btn.addEventListener('click', () => editRaidLevels(btn.dataset.editRaid));
  });
  container.querySelectorAll('[data-delete-raid]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!confirm('이 커스텀 레이드를 삭제하시겠습니까?')) return;
      state.customRaids = state.customRaids.filter(r => r.id !== btn.dataset.deleteRaid);
      saveState();
      renderRaidSelector();
      renderRaids();
    });
  });
  container.querySelectorAll('[data-reassign]').forEach(btn => {
    btn.addEventListener('click', () => {
      renderRaids();
    });
  });
}

function renderRaidCard(raid, result) {
  const { parties, leftoverDealers, leftoverSupports, totalCandidates, targetPartyCount } = result;

  const partiesHtml = parties.map((party, i) => {
    const membersHtml = party.members.map(m => renderCharChip(m)).join('');
    const avgDisplay = party.avgLevel.toFixed(2);
    const warningHtml = !party.hasSupport
      ? '<div class="party-warning">⚠ 서포터 부족</div>' : '';
    // 인원 미달 경고
    const isPartyFull = party.members.length >= 4;
    const shortageHtml = !isPartyFull
      ? `<div class="party-warning">⚠ 인원 미달 (${party.members.length}/4) - 같은 원정대 캐릭은 1명만 가능</div>`
      : '';
    return `
      <div class="party-card ${!party.hasSupport ? 'no-support' : ''} ${!isPartyFull ? 'incomplete' : ''}">
        <div class="party-header">
          <span class="party-label">파티 ${i + 1}</span>
          <span class="party-avg">평균 ${avgDisplay}</span>
        </div>
        ${warningHtml}
        ${shortageHtml}
        <div class="party-members drop-zone" data-raid-id="${raid.id}" data-party-index="${i}">
          ${membersHtml}
        </div>
      </div>
    `;
  }).join('');

  const leftoverHtml = (leftoverDealers.length > 0 || leftoverSupports.length > 0) ? `
    <div class="leftover-section">
      <h4 class="leftover-title">남은 캐릭터 <span class="hint">(드래그로 파티에 추가 가능)</span></h4>
      <div class="party-members drop-zone leftover-zone" data-raid-id="${raid.id}" data-party-index="leftover">
        ${[...leftoverSupports, ...leftoverDealers].map(m => renderCharChip(m)).join('')}
      </div>
    </div>
  ` : '';

  const isCustom = raid.category === '커스텀';
  const overrideNotice = state.raidOverrides[raid.id] ? ' (수정됨)' : '';

  return `
    <article class="raid-card" data-raid-id="${raid.id}">
      <header class="raid-header">
        <div class="raid-title-group">
          <h3 class="raid-title">${escapeHtml(raid.name)}</h3>
          <span class="raid-range">${raid.partySize}인 · ${raid.minLevel} ~ ${(raid.maxLevel - 0.01).toFixed(0)}${overrideNotice}</span>
        </div>
        <div class="raid-meta">
          <span class="raid-count">후보 ${totalCandidates}명 · 파티 ${parties.length}/${targetPartyCount}개</span>
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
  const assignedRaids = charAssignmentMap[char.id] || [];
  const dupCount = assignedRaids.length;
  const isDup = dupCount >= 2;
  const badge = isDup
    ? `<span class="chip-dup-badge" title="${escapeHtml(assignedRaids.join(', '))}">×${dupCount}</span>`
    : '';
  const tooltipTitle = isDup
    ? `이 캐릭터는 ${dupCount}개 레이드에 배정됨:\n- ${assignedRaids.join('\n- ')}`
    : `[${char.rosterRep}] 원정대`;
  return `
    <div class="char-chip ${supportClass} ${isDup ? 'is-duplicate' : ''}"
         draggable="true"
         data-char-id="${char.id}"
         data-char-level="${char.level}"
         data-is-support="${char.isSupport}"
         data-roster-rep="${escapeHtml(char.rosterRep)}"
         title="${escapeHtml(tooltipTitle)}">
      <span class="chip-name">${escapeHtml(char.name)}${badge}</span>
      <span class="chip-class">${escapeHtml(char.className)}</span>
      <span class="chip-level">${char.level.toFixed(2)}</span>
    </div>
  `;
}

// ─── 드래그 앤 드롭 ───
function initDragAndDrop() {
  const zones = $$('.drop-zone');
  zones.forEach(zone => {
    const raidId = zone.dataset.raidId;
    Sortable.create(zone, {
      group: `raid_${raidId}`,
      animation: 150,
      ghostClass: 'chip-ghost',
      chosenClass: 'chip-chosen',
      dragClass: 'chip-drag',
      onMove: (evt) => {
        // 드롭하려는 파티에 이미 같은 원정대 캐릭이 있으면 거부 표시
        const targetZone = evt.to;
        const draggedRoster = evt.dragged.dataset.rosterRep;
        const draggedId = evt.dragged.dataset.charId;
        if (!draggedRoster) return true;
        // leftover-zone이면 원정대 중복 상관 없음 (그냥 보관함)
        if (targetZone.classList.contains('leftover-zone')) return true;
        // 파티 영역이면 체크
        const existingChips = targetZone.querySelectorAll('.char-chip');
        for (const chip of existingChips) {
          if (chip.dataset.charId === draggedId) continue; // 자기자신은 무시
          if (chip.dataset.rosterRep === draggedRoster) {
            return false; // 거부: 같은 원정대 이미 있음
          }
        }
        return true;
      },
      onEnd: (evt) => handleDragEnd(evt, raidId),
    });
  });
}

function handleDragEnd(evt, raidId) {
  const raidCard = evt.to.closest('.raid-card');
  if (!raidCard) return;

  const zones = raidCard.querySelectorAll('.party-members');
  zones.forEach(zone => {
    const chips = zone.querySelectorAll('.char-chip');
    const partyCard = zone.closest('.party-card');
    if (!partyCard) return;

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
    partyCard.classList.toggle('incomplete', cnt < 4);

    // 기존 경고 제거 후 재생성
    partyCard.querySelectorAll('.party-warning').forEach(w => w.remove());
    const header = partyCard.querySelector('.party-header');
    if (!hasSupport && cnt > 0) {
      const warn = document.createElement('div');
      warn.className = 'party-warning';
      warn.textContent = '⚠ 서포터 부족';
      header.after(warn);
    }
    if (cnt < 4 && cnt > 0) {
      const warn = document.createElement('div');
      warn.className = 'party-warning';
      warn.textContent = `⚠ 인원 미달 (${cnt}/4)`;
      header.after(warn);
    }
  });

  updateDuplicateBadges();
}

/**
 * 현재 DOM 상태 기준으로 모든 칩의 중복 배정 배지 재계산
 */
function updateDuplicateBadges() {
  const map = {};
  document.querySelectorAll('.raid-card').forEach(raidCard => {
    const raidTitleEl = raidCard.querySelector('.raid-title');
    const raidName = raidTitleEl ? raidTitleEl.textContent : '';
    raidCard.querySelectorAll('.party-card .char-chip').forEach(chip => {
      const id = chip.dataset.charId;
      if (!map[id]) map[id] = [];
      map[id].push(raidName);
    });
  });
  charAssignmentMap = map;

  document.querySelectorAll('.char-chip').forEach(chip => {
    const id = chip.dataset.charId;
    const raids = map[id] || [];
    const dupCount = raids.length;
    const isDup = dupCount >= 2;

    chip.classList.toggle('is-duplicate', isDup);

    const oldBadge = chip.querySelector('.chip-dup-badge');
    if (oldBadge) oldBadge.remove();

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
      const rosterRep = chip.dataset.rosterRep;
      chip.title = rosterRep ? `[${rosterRep}] 원정대` : '';
    }
  });
}

// ─── 레이드 레벨 수정 ───
function editRaidLevels(raidId) {
  const raid = getRaidById(raidId);
  if (!raid) return;
  const newMin = prompt(`${raid.name}의 최소 아이템레벨:`, raid.minLevel);
  if (newMin === null) return;
  const newMax = prompt(`${raid.name}의 상한 아이템레벨 (이 값 미만까지 매칭):`, raid.maxLevel);
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
  renderRaidSelector();
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

// ─── 유틸 ───
function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
