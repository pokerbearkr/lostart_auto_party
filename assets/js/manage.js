/**
 * 관리 페이지 (manage.html) 전용 스크립트
 * - 탭 3개 전환
 * - API 키 저장 / 공유 링크 복사
 * - 원정대 추가/관리
 * - 레이드 선택 / 커스텀 레이드 추가
 *
 * 공통 함수(getAllRaids, addRoster 등)는 core.js에서 가져다 사용한다.
 * UI 렌더링 함수(renderRosters 등)는 이 파일에 자체 구현.
 */

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// ─── 초기화 ───
window.addEventListener('DOMContentLoaded', () => {
  loadState();

  // URL 파라미터로 API 키가 전달됐으면 자동 저장
  const keyApplied = applyApiKeyFromUrl();

  initTabSystem();
  initApiKeyHandlers();
  initRosterHandlers();
  initRaidHandlers();
  initGlobalHandlers();

  renderApiKeyStatus();
  renderRosters();
  renderRaidSelector();

  if (keyApplied) {
    showToast('✓ API 키가 자동으로 적용되었습니다');
  }
});

// ═══════════════════════════════════════════════════════════
//  탭 시스템
// ═══════════════════════════════════════════════════════════
function initTabSystem() {
  // URL 해시로 탭 복원 (#api, #rosters, #raids)
  const hash = window.location.hash.replace('#', '');
  if (hash) activateTab(hash);

  $$('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      activateTab(btn.dataset.tab);
    });
  });
}

function activateTab(tabName) {
  $$('.tab-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tabName);
  });
  $$('.tab-content').forEach(c => {
    c.classList.toggle('active', c.dataset.tabContent === tabName);
  });
  // URL 해시에 반영 (페이지 새로고침해도 같은 탭 유지)
  history.replaceState(null, '', '#' + tabName);
}

// ═══════════════════════════════════════════════════════════
//  API 키 탭
// ═══════════════════════════════════════════════════════════
function initApiKeyHandlers() {
  $('#api-key-save').addEventListener('click', () => {
    const val = $('#api-key-input').value.trim();
    if (!val) { alert('API 키를 입력해주세요.'); return; }
    state.apiKey = val;
    saveState();
    renderApiKeyStatus();
    showToast('API 키가 저장되었습니다.');
  });

  // 엔터로 저장
  $('#api-key-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('#api-key-save').click();
  });

  // 공유 링크 복사
  $('#share-link-btn').addEventListener('click', async () => {
    if (!state.apiKey) {
      alert('먼저 API 키를 저장해주세요.');
      return;
    }
    // 공유 링크는 메인 페이지 (index.html)로 가도록
    const base = window.location.origin + window.location.pathname.replace(/manage\.html$/, 'index.html');
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

function renderApiKeyStatus() {
  const status = $('#api-key-status');
  if (state.apiKey) {
    status.className = 'api-status saved';
    status.textContent = `● 저장됨 (${state.apiKey.substring(0, 8)}...)`;
    $('#api-key-input').value = state.apiKey;
  } else {
    status.className = 'api-status empty';
    status.textContent = '○ API 키 미설정';
  }
}

// ═══════════════════════════════════════════════════════════
//  원정대 탭
// ═══════════════════════════════════════════════════════════
function initRosterHandlers() {
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
}

// 원정대 목록 렌더링
function renderRosters() {
  const container = $('#rosters-list');
  if (!container) return;

  if (state.rosters.length === 0) {
    container.innerHTML = '<p class="empty-msg">등록된 원정대가 없습니다.</p>';
    return;
  }

  container.innerHTML = state.rosters.map(r => {
    const chars = r.characters.sort((a, b) => b.level - a.level);
    const charRows = chars.map(c => {
      const excluded = state.excludedChars.has(c.id);
      const cp = c.combatPower > 0 ? c.combatPower.toLocaleString() : '-';
      return `
        <tr class="${excluded ? 'excluded' : ''}">
          <td class="name-cell" data-class="${escapeHtml(c.className)}${c.isSupport ? ' (폿)' : ''}">${escapeHtml(c.name)}</td>
          <td class="class-cell ${c.isSupport ? 'is-support' : ''}">${escapeHtml(c.className)}</td>
          <td class="level-cell" data-power="${escapeHtml(cp)}">${c.level.toFixed(2)}</td>
          <td class="power-cell">${cp}</td>
          <td class="action-cell">
            <label class="exclude-label" title="체크하면 이 캐릭은 파티 편성에서 일시 제외됩니다."><input type="checkbox" data-char-id="${c.id}" class="exclude-checkbox" ${excluded ? 'checked' : ''}> 제외</label>
            <button class="char-delete-btn" data-delete-char="${c.id}" title="이 캐릭을 목록에서 완전히 삭제합니다.">×</button>
          </td>
        </tr>`;
    }).join('');

    const supCount = chars.filter(c => c.isSupport && !state.excludedChars.has(c.id)).length;
    const dpsCount = chars.filter(c => !c.isSupport && !state.excludedChars.has(c.id)).length;
    const withPower = chars.filter(c => c.combatPower > 0).length;
    const missingPower = chars.length - withPower;
    const powerStatus = missingPower > 0
      ? `<span class="roster-power-warn" title="전투력 없는 캐릭: ${missingPower}명">⚠ 전투력 ${withPower}/${chars.length}</span>`
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

  // 갱신 버튼
  container.querySelectorAll('[data-refresh]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const name = btn.dataset.refresh;
      btn.disabled = true;
      btn.textContent = '...';
      try {
        await refreshRoster(name, (cur, tot) => {
          btn.textContent = `${cur}/${tot}`;
        });
        renderRosters();
      } catch (e) {
        alert(e.message);
      }
    });
  });

  // 전투력만 재조회
  container.querySelectorAll('[data-refresh-power]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const name = btn.dataset.refreshPower;
      btn.disabled = true;
      const original = btn.textContent;
      try {
        const fixed = await refreshMissingCombatPower(name, (cur, tot) => {
          btn.textContent = `${cur}/${tot}`;
        });
        showToast(`전투력 재조회 완료: ${fixed}명 업데이트됨`);
        renderRosters();
      } catch (e) {
        alert('재조회 실패: ' + e.message);
      } finally {
        btn.disabled = false;
        btn.textContent = original;
      }
    });
  });

  // 원정대 삭제
  container.querySelectorAll('[data-remove]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!confirm(`'${btn.dataset.remove}' 원정대를 삭제하시겠습니까?`)) return;
      removeRoster(btn.dataset.remove);
      renderRosters();
    });
  });

  // 캐릭터 제외 체크박스
  container.querySelectorAll('.exclude-checkbox').forEach(cb => {
    cb.addEventListener('change', () => {
      const id = cb.dataset.charId;
      if (cb.checked) state.excludedChars.add(id);
      else state.excludedChars.delete(id);
      saveState();
      renderRosters();
    });
  });

  // 캐릭터 완전 삭제
  container.querySelectorAll('.char-delete-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.deleteChar;
      const ch = findCharById(id);
      const displayName = ch ? ch.name : id;
      if (!confirm(`'${displayName}' 캐릭터를 목록에서 완전히 삭제하시겠습니까?\n(원정대 갱신해도 다시 나타나지 않습니다)`)) return;
      deleteCharacter(id);
      renderRosters();
    });
  });
}

// ═══════════════════════════════════════════════════════════
//  레이드 탭
// ═══════════════════════════════════════════════════════════
function initRaidHandlers() {
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
    if (state.enabledRaids !== null) state.enabledRaids.add(id);
    saveState();
    $('#custom-raid-name').value = '';
    $('#custom-raid-min').value = '';
    $('#custom-raid-max').value = '';
    renderRaidSelector();
  });
}

// 레이드 선택 체크박스 렌더링
function renderRaidSelector() {
  const container = $('#raid-selector');
  if (!container) return;

  const raids = getAllRaids();
  const byCategory = {};
  for (const r of raids) {
    const cat = r.category || '기타';
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(r);
  }
  for (const cat in byCategory) {
    byCategory[cat].sort((a, b) => b.minLevel - a.minLevel);
  }
  const sortedEntries = Object.entries(byCategory).sort(([, a], [, b]) =>
    Math.max(...b.map(x => x.minLevel)) - Math.max(...a.map(x => x.minLevel))
  );

  container.innerHTML = sortedEntries.map(([cat, items]) => `
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

  // 개별 체크박스
  container.querySelectorAll('.raid-sel-check').forEach(cb => {
    cb.addEventListener('change', () => {
      if (state.enabledRaids === null) {
        // 첫 토글: 전체 활성 목록 초기화
        state.enabledRaids = new Set(getAllRaids().filter(isRaidEnabled).map(r => r.id));
      }
      const id = cb.dataset.raidId;
      if (cb.checked) state.enabledRaids.add(id);
      else state.enabledRaids.delete(id);
      saveState();
      cb.closest('.raid-sel-item').classList.toggle('on', cb.checked);
    });
  });

  // 카테고리 전체/해제
  container.querySelectorAll('[data-sel-cat]').forEach(btn => {
    btn.addEventListener('click', () => {
      const cat = btn.dataset.selCat;
      const turnOn = btn.dataset.selAction === 'on';
      if (state.enabledRaids === null) {
        state.enabledRaids = new Set(getAllRaids().filter(isRaidEnabled).map(r => r.id));
      }
      const targets = getAllRaids().filter(r => (r.category || '기타') === cat);
      targets.forEach(r => {
        if (turnOn) state.enabledRaids.add(r.id);
        else state.enabledRaids.delete(r.id);
      });
      saveState();
      renderRaidSelector();
    });
  });
}

// ═══════════════════════════════════════════════════════════
//  공통: 전체 초기화
// ═══════════════════════════════════════════════════════════
function initGlobalHandlers() {
  $('#clear-all-btn').addEventListener('click', () => {
    if (!confirm('모든 데이터를 초기화하시겠습니까? (API 키 포함)')) return;
    localStorage.removeItem(LS_KEY);
    state.apiKey = '';
    state.rosters = [];
    state.customRaids = [];
    state.raidOverrides = {};
    state.excludedChars = new Set();
    state.deletedChars = new Set();
    state.enabledRaids = null;
    state.manualGroups = {};
    state.autoLabels = {};
    renderApiKeyStatus();
    renderRosters();
    renderRaidSelector();
    showToast('초기화되었습니다.');
  });
}

// ═══════════════════════════════════════════════════════════
//  공통 유틸 (app.js와 중복이지만 manage.js 단독 동작 위해 포함)
// ═══════════════════════════════════════════════════════════
function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function showToast(msg) {
  let toast = $('.toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove('show'), 2500);
}
