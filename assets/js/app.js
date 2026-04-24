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
  // URL 파라미터로 API 키가 전달됐으면 자동 저장
  const keyApplied = applyApiKeyFromUrl();
  initEventListeners();
  renderAll();
  if (keyApplied) {
    showToast('✓ API 키가 자동으로 적용되었습니다');
  }
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

  // 공유 링크 복사 - 현재 URL + ?k=저장된키
  const shareBtn = $('#share-link-btn');
  if (shareBtn) {
    shareBtn.addEventListener('click', async () => {
      if (!state.apiKey) {
        alert('먼저 API 키를 저장해주세요.');
        return;
      }
      const base = window.location.origin + window.location.pathname;
      const shareUrl = `${base}?k=${encodeURIComponent(state.apiKey)}`;

      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(shareUrl);
          showToast('✓ 공유 링크가 클립보드에 복사되었습니다');
        } else {
          const ta = document.createElement('textarea');
          ta.value = shareUrl;
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          document.body.removeChild(ta);
          showToast('✓ 공유 링크가 복사되었습니다');
        }
      } catch (e) {
        prompt('아래 링크를 복사하여 공유하세요:', shareUrl);
      }
    });
  }

  // 원정대 추가
  $('#add-roster-btn').addEventListener('click', async () => {
    const input = $('#roster-name-input');
    const name = input.value.trim();
    if (!name) { alert('캐릭터명을 입력해주세요.'); return; }
    const btn = $('#add-roster-btn');
    btn.disabled = true;
    btn.textContent = '불러오는 중...';
    try {
      await addRoster(name, (current, total, msg) => {
        btn.textContent = total > 1 ? `${current}/${total} ${msg}` : msg;
      });
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
    try {
      const total = state.rosters.length;
      for (let i = 0; i < state.rosters.length; i++) {
        const r = state.rosters[i];
        await refreshRoster(r.repName, (cur, tot, msg) => {
          btn.textContent = `[${i+1}/${total}] ${cur}/${tot} ${msg}`;
        });
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
    state.manualGroups = {};
    state.autoLabels = {};
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
      const cp = c.combatPower > 0 ? c.combatPower.toLocaleString() : '-';
      return `
        <tr class="${excluded ? 'excluded' : ''}">
          <td class="name-cell">${escapeHtml(c.name)}</td>
          <td class="class-cell ${c.isSupport ? 'is-support' : ''}">${escapeHtml(c.className)}</td>
          <td class="level-cell">${c.level.toFixed(2)}</td>
          <td class="power-cell">${cp}</td>
          <td class="exclude-cell">
            <label><input type="checkbox" data-char-id="${c.id}" class="exclude-checkbox" ${excluded ? 'checked' : ''}> 제외</label>
          </td>
        </tr>`;
    }).join('');
    const supCount = chars.filter(c => c.isSupport && !state.excludedChars.has(c.id)).length;
    const dpsCount = chars.filter(c => !c.isSupport && !state.excludedChars.has(c.id)).length;
    const withPower = chars.filter(c => c.combatPower > 0).length;
    const missingPower = chars.length - withPower;
    const powerStatus = missingPower > 0
      ? `<span class="roster-power-warn" title="전투력 없는 캐릭: ${missingPower}명. '전투력 재조회' 버튼을 눌러보세요.">⚠ 전투력 ${withPower}/${chars.length}</span>`
      : `<span class="roster-power-ok">✓ 전투력 ${withPower}/${chars.length}</span>`;
    return `
      <div class="roster-card">
        <div class="roster-header">
          <h3>${escapeHtml(r.repName)} <span class="roster-counts">딜 ${dpsCount} · 폿 ${supCount}</span></h3>
          <div class="roster-actions">
            ${missingPower > 0 ? `<button class="btn-sm" data-refresh-power="${escapeHtml(r.repName)}" title="전투력이 없는 캐릭만 다시 불러옵니다">전투력 재조회</button>` : ''}
            <button class="btn-sm" data-refresh="${escapeHtml(r.repName)}">전체 갱신</button>
            <button class="btn-sm btn-danger" data-remove="${escapeHtml(r.repName)}">삭제</button>
          </div>
        </div>
        <div class="roster-status">${powerStatus}</div>
        <table class="char-table">
          <thead><tr><th>캐릭명</th><th>직업</th><th>템렙</th><th>전투력</th><th></th></tr></thead>
          <tbody>${charRows}</tbody>
        </table>
      </div>
    `;
  }).join('');

  // 기존 갱신 버튼
  container.querySelectorAll('[data-refresh]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const name = btn.dataset.refresh;
      btn.disabled = true;
      btn.textContent = '...';
      try {
        await refreshRoster(name, (cur, tot, msg) => {
          btn.textContent = `${cur}/${tot}`;
        });
        renderRosters();
        renderRaids();
      } catch (e) {
        alert(e.message);
      }
    });
  });

  // 전투력 재조회 버튼 (없는 것만)
  container.querySelectorAll('[data-refresh-power]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const name = btn.dataset.refreshPower;
      btn.disabled = true;
      const originalText = btn.textContent;
      try {
        const fixed = await refreshMissingCombatPower(name, (cur, tot, msg) => {
          btn.textContent = `${cur}/${tot}`;
        });
        showToast(`전투력 재조회 완료: ${fixed}명 업데이트됨`);
        renderRosters();
        renderRaids();
      } catch (e) {
        alert('재조회 실패: ' + e.message);
      } finally {
        btn.disabled = false;
        btn.textContent = originalText;
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

  // 중복 배정 집계 (자동 + 수동 공격대 모두 포함)
  charAssignmentMap = {};
  for (const { raid, result } of raidsWithData) {
    // 자동
    for (const group of result.raidGroups) {
      for (const party of group.parties) {
        for (const member of party.members) {
          if (!charAssignmentMap[member.id]) charAssignmentMap[member.id] = [];
          charAssignmentMap[member.id].push(raid.name);
        }
      }
    }
    // 수동
    const manualGroups = getManualGroupsForRaid(raid.id);
    for (const group of manualGroups) {
      for (const party of group.parties) {
        for (const member of party.members) {
          if (!charAssignmentMap[member.id]) charAssignmentMap[member.id] = [];
          charAssignmentMap[member.id].push(`${raid.name} (수동)`);
        }
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

  // ─── 수동 공격대 추가 ───
  container.querySelectorAll('[data-add-manual]').forEach(btn => {
    btn.addEventListener('click', () => {
      const raidId = btn.dataset.addManual;
      addManualGroup(raidId);
      renderRaids();
    });
  });

  // 수동 공격대 삭제
  container.querySelectorAll('[data-remove-manual]').forEach(btn => {
    btn.addEventListener('click', () => {
      const [groupId, raidId] = btn.dataset.removeManual.split('|');
      if (!confirm('이 공격대를 삭제하시겠습니까? (들어있는 캐릭은 복원되지 않으며, 풀로 돌아갑니다)')) return;
      removeManualGroup(raidId, groupId);
      renderRaids();
    });
  });

  // 수동 공격대에 빈 파티 추가
  container.querySelectorAll('[data-add-manual-party]').forEach(btn => {
    btn.addEventListener('click', () => {
      const [groupId, raidId] = btn.dataset.addManualParty.split('|');
      addEmptyPartyToManualGroup(raidId, groupId);
      renderRaids();
    });
  });

  // 수동 공격대의 특정 파티 삭제
  container.querySelectorAll('[data-remove-manual-party]').forEach(btn => {
    btn.addEventListener('click', () => {
      const [groupId, partyIdxStr, raidId] = btn.dataset.removeManualParty.split('|');
      const partyIdx = parseInt(partyIdxStr, 10);
      if (!confirm('이 파티를 삭제하시겠습니까?')) return;
      removePartyFromManualGroup(raidId, groupId, partyIdx);
      renderRaids();
    });
  });

  // ═══ 편집 가능한 이름 (공격대/파티 모두) ═══
  container.querySelectorAll('.editable-label').forEach(inp => {
    // 포커스 해제/엔터 시 저장
    const commit = () => {
      const value = inp.value.trim() || inp.dataset.default;
      inp.value = value;

      if (inp.dataset.manualLabel) {
        // 수동 공격대 이름
        const [groupId, raidId] = inp.dataset.manualLabel.split('|');
        renameManualGroup(raidId, groupId, value);
      } else if (inp.dataset.manualPartyLabel) {
        // 수동 공격대 내부 파티 이름
        const [groupId, partyIdxStr, raidId] = inp.dataset.manualPartyLabel.split('|');
        setManualPartyLabel(raidId, groupId, parseInt(partyIdxStr, 10), value);
      } else if (inp.dataset.autoGroupLabel) {
        // 자동 공격대 이름
        const [raidId, giStr] = inp.dataset.autoGroupLabel.split('|');
        setAutoGroupLabel(raidId, parseInt(giStr, 10), value);
      } else if (inp.dataset.autoPartyLabel) {
        // 자동 공격대 내부 파티 이름
        const [raidId, giStr, piStr] = inp.dataset.autoPartyLabel.split('|');
        setAutoPartyLabel(raidId, parseInt(giStr, 10), parseInt(piStr, 10), value);
      }
    };
    inp.addEventListener('blur', commit);
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); inp.blur(); }
      if (e.key === 'Escape') { inp.value = inp.dataset.default; inp.blur(); }
      e.stopPropagation();
    });
    inp.addEventListener('click', (e) => e.stopPropagation());
    inp.addEventListener('mousedown', (e) => e.stopPropagation()); // 드래그 간섭 방지
  });
}

function renderRaidCard(raid, result) {
  const { raidGroups, leftoverDealers, leftoverSupports, totalCandidates, partiesPerGroup } = result;

  // 수동 공격대
  const manualGroups = getManualGroupsForRaid(raid.id);

  // 총 파티 수 집계
  const totalParties = raidGroups.reduce((sum, g) => sum + g.parties.length, 0);

  // 자동 공격대 렌더링
  const autoGroupsHtml = raidGroups.map((group, gi) =>
    renderGroupBlock({
      raid, gi, group,
      isManual: false, partiesPerGroup,
      label: partiesPerGroup > 1 ? `공격대 ${gi + 1}` : `파티 ${gi + 1}`,
    })
  ).join('');

  // 수동 공격대 렌더링
  const manualGroupsHtml = manualGroups.map((group, mi) =>
    renderGroupBlock({
      raid, gi: mi, group,
      isManual: true, manualGroupId: group.id, partiesPerGroup,
      label: `★ ${group.label}`,
    })
  ).join('');

  const leftoverHtml = (leftoverDealers.length > 0 || leftoverSupports.length > 0) ? `
    <div class="leftover-section">
      <h4 class="leftover-title">남은 캐릭터 <span class="hint">(공팟용 · 드래그로 파티에 추가 가능)</span></h4>
      <div class="party-members drop-zone leftover-zone" data-raid-id="${raid.id}" data-party-index="leftover">
        ${[...leftoverSupports, ...leftoverDealers].map(m => renderCharChip(m)).join('')}
      </div>
    </div>
  ` : '';

  const isCustom = raid.category === '커스텀';
  const overrideNotice = state.raidOverrides[raid.id] ? ' (수정됨)' : '';
  const groupTypeLabel = partiesPerGroup > 1 ? '공격대' : '파티';

  const anyContent = raidGroups.length > 0 || manualGroups.length > 0;

  return `
    <article class="raid-card" data-raid-id="${raid.id}">
      <header class="raid-header">
        <div class="raid-title-group">
          <h3 class="raid-title">${escapeHtml(raid.name)}</h3>
          <span class="raid-range">${raid.partySize}인 · ${raid.minLevel} ~ ${(raid.maxLevel - 0.01).toFixed(0)}${overrideNotice}</span>
        </div>
        <div class="raid-meta">
          <span class="raid-count">후보 ${totalCandidates}명 · 자동 ${groupTypeLabel} ${raidGroups.length}개${manualGroups.length > 0 ? ` · 수동 ${manualGroups.length}개` : ''}</span>
          <button class="btn-xs btn-primary" data-add-manual="${raid.id}">+ 내 ${groupTypeLabel} 추가</button>
          <button class="btn-xs" data-edit-raid="${raid.id}">레벨수정</button>
          <button class="btn-xs" data-reassign="${raid.id}">재배치</button>
          ${isCustom ? `<button class="btn-xs btn-danger" data-delete-raid="${raid.id}">삭제</button>` : ''}
        </div>
      </header>
      ${anyContent
        ? (autoGroupsHtml + manualGroupsHtml)
        : '<p class="empty-msg-small">매칭 가능한 파티가 없습니다. "내 공격대 추가"로 직접 만들 수 있어요.</p>'}
      ${leftoverHtml}
    </article>
  `;
}

/**
 * 공격대 하나를 렌더링. 자동/수동 모두 이 함수로 생성.
 */
function renderGroupBlock({ raid, gi, group, isManual, manualGroupId, partiesPerGroup, label }) {
  const partiesHtml = group.parties.map((party, pi) => {
    const membersHtml = party.members.map(m => renderCharChip(m)).join('');
    const avgPower = party.members.length > 0 ? party.avgPower.toFixed(0) : '-';
    const avgLevel = party.members.length > 0 ? party.avgLevel.toFixed(2) : '-';
    const warningHtml = party.members.length > 0 && !party.hasSupport
      ? '<div class="party-warning">⚠ 서포터 부족</div>' : '';
    const isPartyFull = party.members.length >= 4;
    const shortageHtml = party.members.length > 0 && !isPartyFull
      ? `<div class="party-warning">⚠ 인원 미달 (${party.members.length}/4)</div>`
      : '';
    const emptyHtml = party.members.length === 0 && isManual
      ? '<div class="party-empty-hint">여기로 캐릭터를 드래그하세요</div>' : '';
    const removeBtn = isManual
      ? `<button class="party-remove-btn" data-remove-manual-party="${manualGroupId}|${pi}|${raid.id}" title="이 파티 삭제">×</button>`
      : '';

    // 파티 이름 (편집 가능)
    const defaultPartyName = `파티 ${pi + 1}`;
    const partyName = isManual
      ? (group.partyLabels && group.partyLabels[pi] ? group.partyLabels[pi] : defaultPartyName)
      : getAutoPartyLabel(raid.id, gi, pi, defaultPartyName);
    const partyLabelAttr = isManual
      ? `data-manual-party-label="${manualGroupId}|${pi}|${raid.id}"`
      : `data-auto-party-label="${raid.id}|${gi}|${pi}"`;

    return `
      <div class="party-card ${party.members.length > 0 && !party.hasSupport ? 'no-support' : ''} ${party.members.length > 0 && !isPartyFull ? 'incomplete' : ''} ${isManual ? 'manual' : ''}">
        <div class="party-header">
          <span class="party-label">
            <input type="text" class="editable-label"
                   value="${escapeHtml(partyName)}"
                   data-default="${escapeHtml(defaultPartyName)}"
                   ${partyLabelAttr}
                   title="클릭해서 이름 수정">
            ${removeBtn}
          </span>
          <span class="party-avg">
            <span class="party-avg-power">⚔ ${avgPower}</span>
            <span class="party-avg-level">Lv ${avgLevel}</span>
          </span>
        </div>
        ${warningHtml}
        ${shortageHtml}
        ${emptyHtml}
        <div class="party-members drop-zone ${isManual ? 'manual-zone' : ''}"
             data-raid-id="${raid.id}"
             data-group-index="${gi}"
             data-party-index="${pi}"
             ${isManual ? `data-manual-group-id="${manualGroupId}"` : ''}>
          ${membersHtml}
        </div>
      </div>
    `;
  }).join('');

  // 공격대 이름 (편집 가능)
  const displayLabel = isManual
    ? group.label
    : (partiesPerGroup > 1 ? label : null); // 4인 레이드는 공격대 헤더 없음
  const groupLabelAttr = isManual
    ? `data-manual-label="${manualGroupId}|${raid.id}"`
    : `data-auto-group-label="${raid.id}|${gi}"`;

  const showHeader = displayLabel !== null;
  const labelEl = showHeader
    ? `<input type="text" class="editable-label"
            value="${escapeHtml(displayLabel || '')}"
            data-default="${escapeHtml(partiesPerGroup > 1 ? `공격대 ${gi + 1}` : `파티 ${gi + 1}`)}"
            ${groupLabelAttr}
            title="클릭해서 이름 수정">`
    : '';

  const actions = isManual ? `
    <button class="btn-xs" data-add-manual-party="${manualGroupId}|${raid.id}">+ 파티</button>
    <button class="btn-xs btn-danger" data-remove-manual="${manualGroupId}|${raid.id}">공격대 삭제</button>
  ` : '';

  return `
    <div class="raid-group ${isManual ? 'is-manual' : ''}">
      ${showHeader ? `
        <div class="raid-group-header">
          ${labelEl}
          <div class="raid-group-actions">${actions}</div>
        </div>
      ` : ''}
      <div class="parties-grid">${partiesHtml}</div>
    </div>
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
  const hasPower = char.combatPower > 0;
  const powerDisplay = hasPower ? char.combatPower.toLocaleString() : '?';
  const noPowerWarn = !hasPower ? '<span class="chip-no-power" title="전투력 정보 없음 (템렙 기반으로 계산)">?</span>' : '';
  const tooltipTitle = isDup
    ? `이 캐릭터는 ${dupCount}개 레이드에 배정됨:\n- ${assignedRaids.join('\n- ')}`
    : `[${char.rosterRep}] 원정대${hasPower ? '' : ' · 전투력 정보 없음'}`;
  return `
    <div class="char-chip ${supportClass} ${isDup ? 'is-duplicate' : ''}"
         draggable="true"
         data-char-id="${char.id}"
         data-char-level="${char.level}"
         data-combat-power="${char.combatPower || 0}"
         data-is-support="${char.isSupport}"
         data-roster-rep="${escapeHtml(char.rosterRep)}"
         title="${escapeHtml(tooltipTitle)}">
      <span class="chip-name">${escapeHtml(char.name)}${badge}</span>
      <span class="chip-class">${escapeHtml(char.className)}</span>
      <span class="chip-stats">
        <span class="chip-power">⚔ ${powerDisplay}${noPowerWarn}</span>
        <span class="chip-level">Lv ${char.level.toFixed(2)}</span>
      </span>
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

    let sumLevel = 0, sumPower = 0, cnt = 0;
    let hasSupport = false;
    chips.forEach(chip => {
      sumLevel += parseFloat(chip.dataset.charLevel);
      const p = parseFloat(chip.dataset.combatPower) || 0;
      sumPower += p > 0 ? p : parseFloat(chip.dataset.charLevel) * 2;
      cnt++;
      if (chip.dataset.isSupport === 'true') hasSupport = true;
    });
    const avgLevel = cnt > 0 ? sumLevel / cnt : 0;
    const avgPower = cnt > 0 ? sumPower / cnt : 0;
    const avgEl = partyCard.querySelector('.party-avg');
    if (avgEl) {
      avgEl.innerHTML = `<span class="party-avg-power">⚔ ${cnt > 0 ? avgPower.toFixed(0) : '-'}</span> <span class="party-avg-level">Lv ${cnt > 0 ? avgLevel.toFixed(2) : '-'}</span>`;
    }

    partyCard.classList.toggle('no-support', !hasSupport && cnt > 0);
    partyCard.classList.toggle('incomplete', cnt < 4 && cnt > 0);

    partyCard.querySelectorAll('.party-warning').forEach(w => w.remove());
    partyCard.querySelectorAll('.party-empty-hint').forEach(w => w.remove());
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
    if (cnt === 0 && partyCard.classList.contains('manual')) {
      // 빈 수동 파티에는 드래그 힌트
      const hint = document.createElement('div');
      hint.className = 'party-empty-hint';
      hint.textContent = '아래로 캐릭터를 드래그하세요';
      header.after(hint);
    }
  });

  // ─── 수동 공격대 상태 저장 ───
  // raidCard 내부의 모든 manual-zone을 스캔해서 state.manualGroups 갱신
  raidCard.querySelectorAll('.drop-zone.manual-zone').forEach(zone => {
    const manualGroupId = zone.dataset.manualGroupId;
    const partyIdx = parseInt(zone.dataset.partyIndex, 10);
    const rId = zone.dataset.raidId;
    const charIds = Array.from(zone.querySelectorAll('.char-chip')).map(c => c.dataset.charId);
    if (manualGroupId != null && !isNaN(partyIdx)) {
      updateManualPartyMembers(rId, manualGroupId, partyIdx, charIds);
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
