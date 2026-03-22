// =============================================================
// SpecLens — 메인 앱 로직
// =============================================================

// ─── 상태 ─────────────────────────────────────────────────
const state = {
  modules: [],
  currentModule: null,
  requirements: [],       // 작업 중인 복사본
  savedRequirements: [],  // 저장된 상태 (dirty 비교용)
  isDirty: false,
  votes: {},          // { [번호]: { up, down } }
  commentCounts: {},  // { [번호]: count }
};

// 접힌 그룹 ID 목록 (모듈 전환 시 초기화)
const collapsedGroups = new Set();

// ─── 유틸 ─────────────────────────────────────────────────
function deepClone(obj) { return JSON.parse(JSON.stringify(obj)); }

function moduleName(m) {
  // "1MAIN_메인" → "메인" / "3PRDL_상품목록" → "상품목록"
  const parts = m.split('_');
  return parts.length > 1 ? parts.slice(1).join('_') : m;
}

function moduleCode(m) {
  return m.split('_')[0];
}

// 모듈 카테고리 & 순서 (이미지 기준)
const MODULE_CATEGORIES = {
  dsp: ['MAIN','BNR','PRDL','PRDD','SCH','RCM','CPN','BPS','EVT','MSN','BEN','ANA','UXP','QLT'],
  ord: ['JOIN','GFT','CARD','CHG','CART','DLV','SIM','AUTH','PAY','CCL','PNT'],
  my:  ['FEE','DTC','MOD','MBS','INFO','SUB','MYBEN','MYCPN','MBR','SET','APP','INT','ALM','AGR','CS','GUIDE'],
};

const CAT_LABEL = { dsp: '전시 (DSP)', ord: '주문 (ORD)', my: '고객 (MY)' };
const CAT_ORDER = { dsp: 0, ord: 1, my: 2 };

function getModuleCategory(m) {
  const code = m.replace(/^\d+/, '').split('_')[0];
  for (const [cat, codes] of Object.entries(MODULE_CATEGORIES)) {
    if (codes.includes(code)) return cat;
  }
  return 'dsp';
}

// 이미지 순서: 카테고리 → 모듈명 앞 숫자(2depth no.) 순
function getModuleSortKey(m) {
  const cat = getModuleCategory(m);
  const num = parseInt(m.match(/^(\d+)/)?.[1] ?? 99);
  return CAT_ORDER[cat] * 1000 + num;
}

function priorityOrder(p) {
  return { P1: 1, P2: 2, P3: 3 }[p] || 9;
}

function sortRequirements(reqs) {
  return [...reqs].sort((a, b) => priorityOrder(a.우선순위) - priorityOrder(b.우선순위));
}

function setDirty(val) {
  state.isDirty = val;
  const btn = document.getElementById('btn-save');
  if (btn) btn.classList.toggle('btn-primary', val);
}

let toastTimer = null;
function showToast(msg, duration = 2500) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), duration);
}

// ─── 화면 전환 ────────────────────────────────────────────
const SCREENS = ['config-screen', 'home-screen', 'module-screen'];

function showScreen(id) {
  SCREENS.forEach(sid => {
    const el = document.getElementById(sid);
    if (sid !== id) { el.style.display = 'none'; return; }
    el.style.display = sid === 'config-screen' ? 'flex' : 'block';
  });
}

// ─── 설정 화면 ────────────────────────────────────────────
function renderConfig() {
  showScreen('config-screen');
}

function handleConfigSubmit() {
  const url = document.getElementById('input-script-url').value.trim();
  if (!url || !url.startsWith('https://')) {
    showError('config-error', '올바른 Apps Script URL을 입력해주세요.');
    return;
  }
  SheetsSync.setURL(url);
  loadHome();
}

// ─── 홈 화면 ──────────────────────────────────────────────
async function loadHome() {
  showScreen('home-screen');
  const grid = document.getElementById('module-grid');
  grid.innerHTML = '<div class="loading-wrap"><div class="spinner"></div><p>모듈 목록을 불러오는 중...</p></div>';

  try {
    const { modules, counts, total } = await SheetsSync.getModules();
    state.modules = modules;
    state.counts = counts || {};
    state.total = total || 0;
    renderHomeStats(modules, counts, total);
    renderModuleGrid(modules, counts);
  } catch (err) {
    grid.innerHTML = `<div class="error-banner">불러오기 실패: ${err.message}</div>`;
  }
}

function renderHomeStats(modules, counts, total) {
  const catTotals = { dsp: 0, ord: 0, my: 0 };
  (modules || []).forEach(m => {
    const cat = getModuleCategory(m);
    catTotals[cat] += (counts[m] || 0);
  });
  document.getElementById('home-stats').innerHTML = `
    <span class="home-stat-chip total">전체 <strong>${total.toLocaleString()}</strong>개</span>
    <span class="home-stat-chip dsp">전시 <strong>${catTotals.dsp.toLocaleString()}</strong></span>
    <span class="home-stat-chip ord">주문 <strong>${catTotals.ord.toLocaleString()}</strong></span>
    <span class="home-stat-chip my">고객 <strong>${catTotals.my.toLocaleString()}</strong></span>
  `;
}

function renderModuleGrid(modules, counts) {
  const grid = document.getElementById('module-grid');
  if (!modules.length) {
    grid.innerHTML = '<p style="color:var(--text-muted)">모듈이 없습니다.</p>';
    return;
  }

  // 이미지 순서로 정렬
  const sorted = [...modules].sort((a, b) => getModuleSortKey(a) - getModuleSortKey(b));

  // 카테고리별로 묶어서 그룹 헤더와 함께 렌더링
  let html = '';
  let lastCat = null;
  sorted.forEach(m => {
    const cat = getModuleCategory(m);
    if (cat !== lastCat) {
      if (lastCat !== null) html += '</div>'; // 이전 그룹 닫기
      html += `
        <div class="module-group-header cat-${cat}">
          <span class="module-group-dot"></span>${CAT_LABEL[cat]}
        </div>
        <div class="module-group">`;
      lastCat = cat;
    }
    html += `
      <div class="card module-card cat-${cat}" data-module="${m}" onclick="selectModule('${escHtml(m)}')">
        <div class="module-card-code">${escHtml(moduleCode(m))}</div>
        <div class="module-card-name">${escHtml(moduleName(m))}</div>
        <div class="module-card-count">${(counts && counts[m]) ? counts[m] + '개' : '클릭해서 검토 시작'}</div>
      </div>`;
  });
  if (lastCat !== null) html += '</div>'; // 마지막 그룹 닫기

  grid.innerHTML = html;
}

// ─── 모듈 화면 ────────────────────────────────────────────
async function selectModule(module) {
  state.currentModule = module;
  showScreen('module-screen');

  // 헤더 타이틀
  document.getElementById('module-screen-title').textContent = moduleName(module);
  document.getElementById('req-table-body').innerHTML =
    '<tr><td colspan="6" class="loading-wrap"><div class="spinner"></div><p>요구사항을 불러오는 중...</p></td></tr>';
  document.getElementById('module-stats').innerHTML = '';

  try {
    const [reqData, votesData, countsData] = await Promise.all([
      SheetsSync.getRequirements(module),
      SheetsSync.getVotes().catch(() => ({ votes: {} })),
      SheetsSync.getCommentCounts().catch(() => ({ counts: {} })),
    ]);
    state.requirements   = reqData.requirements;
    state.votes          = votesData.votes   || {};
    state.commentCounts  = countsData.counts || {};
    state.savedRequirements = deepClone(reqData.requirements);
    collapsedGroups.clear();
    setDirty(false);
    renderRequirements();
    renderStats();
  } catch (err) {
    document.getElementById('req-table-body').innerHTML =
      `<tr><td colspan="5"><div class="error-banner">불러오기 실패: ${err.message}</div></td></tr>`;
  }
}

function renderStats() {
  const reqs = state.requirements;
  const p1 = reqs.filter(r => r.우선순위 === 'P1').length;
  const p2 = reqs.filter(r => r.우선순위 === 'P2').length;
  const p3 = reqs.filter(r => r.우선순위 === 'P3').length;
  document.getElementById('module-stats').innerHTML = `
    <span class="stat-chip p1">P1 · ${p1}</span>
    <span class="stat-chip p2">P2 · ${p2}</span>
    <span class="stat-chip p3">P3 · ${p3}</span>
  `;
}

// ─── 계층형 렌더링 ────────────────────────────────────────
// 상위 요구사항은 시트 별도 행이 아닌 "가상 그룹 헤더"
// 동일한 상위요구사항ID를 가진 상세 요구사항들을 하나의 그룹으로 묶음

function buildHierarchy() {
  const reqs = state.requirements;
  const groupMap = {}; // 상위요구사항ID → { id, name, children[] }
  const standalone = []; // 상위요구사항ID 없는 항목

  reqs.forEach(r => {
    const pid = String(r.상위요구사항ID || '').trim();
    if (!pid || pid === 'NEW') {
      standalone.push(r);
      return;
    }
    if (!groupMap[pid]) {
      groupMap[pid] = {
        id: pid,
        name: String(r.상위요구사항 || '').trim() || pid,
        children: [],
      };
    }
    groupMap[pid].children.push(r);
  });

  return { groups: Object.values(groupMap), standalone };
}

// ─── 모듈 요약 ────────────────────────────────────────────
const SUMMARY_TTL = 60 * 60 * 1000; // 1시간

function _summaryKey(module) { return `speclens_summary_${module}`; }

function _getCachedSummary(module) {
  try {
    const raw = localStorage.getItem(_summaryKey(module));
    if (!raw) return null;
    const { text, ts } = JSON.parse(raw);
    if (Date.now() - ts > SUMMARY_TTL) { localStorage.removeItem(_summaryKey(module)); return null; }
    return text;
  } catch { return null; }
}

function _setCachedSummary(module, text) {
  try { localStorage.setItem(_summaryKey(module), JSON.stringify({ text, ts: Date.now() })); } catch {}
}

function renderModuleSummary() {
  const el = document.getElementById('module-summary');
  if (!el || !state.requirements.length) { el && (el.style.display = 'none'); return; }

  const cached = _getCachedSummary(state.currentModule);
  if (cached) {
    _showSummaryText(el, cached);
    return;
  }

  // 로딩 상태 먼저 표시
  el.style.display = 'block';
  el.innerHTML = `
    <div class="summary-card">
      <div class="summary-title">📋 ${escHtml(moduleName(state.currentModule))} 모듈 요약</div>
      <div class="summary-loading"><div class="spinner" style="width:16px;height:16px;border-width:2px;display:inline-block;margin-right:6px;vertical-align:middle"></div>AI가 요약 중이에요...</div>
    </div>`;

  SheetsSync.getModuleSummary(state.currentModule)
    .then(({ summary, error }) => {
      if (summary) {
        _setCachedSummary(state.currentModule, summary);
        _showSummaryText(el, summary);
      } else {
        const msg = error || 'AI 응답이 없습니다. Apps Script에 OPENAI_API_KEY가 설정되어 있는지 확인해주세요.';
        el.style.display = 'block';
        el.innerHTML = `<div class="summary-card"><div class="summary-text" style="color:var(--danger);font-size:.8rem">⚠️ AI 요약 오류: ${escHtml(msg)}</div></div>`;
      }
    })
    .catch(err => {
      el.style.display = 'block';
      el.innerHTML = `<div class="summary-card"><div class="summary-text" style="color:var(--danger);font-size:.8rem">⚠️ AI 요약 오류: ${escHtml(err.message)}</div></div>`;
    });
}

function _showSummaryText(el, text) {
  el.style.display = 'block';
  el.innerHTML = `
    <div class="summary-card">
      <div class="summary-title">📋 ${escHtml(moduleName(state.currentModule))} 모듈 요약</div>
      <div class="summary-text">${escHtml(text)}</div>
    </div>`;
}

function renderRequirements() {
  renderModuleSummary();
  const tbody = document.getElementById('req-table-body');
  if (!state.requirements.length) {
    tbody.innerHTML = `
      <tr><td colspan="6" style="text-align:center;padding:48px;color:var(--text-muted)">
        아직 요구사항이 없어요. 첫 요구사항을 추가해보세요!
      </td></tr>`;
    return;
  }

  const { groups, standalone } = buildHierarchy();
  let html = '';

  // 상위 요구사항 그룹 → 가상 헤더 + 하위 항목
  groups.forEach(group => {
    html += renderVirtualParentRow(group);
    group.children.forEach(child => {
      html += renderReqRow(child, state.requirements.indexOf(child), true);
    });
  });

  // 미분류 (상위요구사항ID 없는) 항목
  if (standalone.length) {
    if (groups.length) {
      html += `<tr class="unassigned-section-row"><td colspan="6">
        미분류 요구사항 — 드래그로 상위 요구사항에 연결하거나 수정에서 그룹을 지정해보세요
      </td></tr>`;
    }
    standalone.forEach(r => {
      html += renderReqRow(r, state.requirements.indexOf(r), false);
    });
  }

  tbody.innerHTML = html;
}

// 가상 상위 요구사항 헤더 행
function renderVirtualParentRow(group) {
  const safeId = escHtml(group.id);
  const safeName = escHtml(group.name);
  return `
  <tr class="req-parent-row" data-group-id="${safeId}">
    <td style="width:28px;text-align:center;color:var(--primary)">◈</td>
    <td></td>
    <td>
      <div class="parent-name">${safeName}</div>
      <div style="font-size:.72rem;color:var(--text-muted);margin-top:3px">ID: ${safeId}</div>
    </td>
    <td></td>
    <td></td>
    <td>
      <div class="row-actions">
        <button class="btn btn-secondary btn-sm"
                onclick="openEditParentModal('${safeId}', '${safeName}')">수정</button>
        <button class="btn btn-danger btn-sm"
                onclick="unlinkParentGroup('${safeId}')">해제</button>
      </div>
    </td>
  </tr>`;
}

// 상세 요구사항 행 (isChild = 상위 그룹 소속 여부)
function renderReqRow(req, idx, isChild) {
  const badge    = (req.우선순위 || 'p2').toLowerCase();
  const reqId    = req.번호 && Number(req.번호) > 0 ? req.번호 : null;
  const voteData = reqId ? (state.votes[String(reqId)] || { up: 0, down: 0 }) : null;
  const userVote = reqId ? (localStorage.getItem(`speclens_vote_${reqId}`) || '') : '';
  const cmtCount = reqId ? (state.commentCounts[String(reqId)] || 0) : 0;

  // 코멘트 버튼 — 요구사항명 옆 인라인
  const commentBtnHtml = reqId ? `
    <button class="comment-btn ${cmtCount > 0 ? 'has-comments' : ''}"
            id="comment-btn-${reqId}"
            onclick="openCommentModal(${reqId}, event)"
            title="${cmtCount > 0 ? cmtCount + '개 코멘트' : '코멘트 추가'}">💬${cmtCount > 0 ? ` <span class="comment-count" id="comment-count-${reqId}">${cmtCount}</span>` : ''}</button>` : '';

  // 투표 버튼 — 별도 칸
  const engagementCell = reqId ? `
    <div class="req-engagement">
      <button class="vote-btn ${userVote === 'up' ? 'voted-up' : ''}"
              id="vote-btn-up-${reqId}"
              onclick="handleVote(${reqId}, 'up', event)">👍 <span id="vote-up-${reqId}">${voteData.up}</span></button>
      <button class="vote-btn ${userVote === 'down' ? 'voted-down' : ''}"
              id="vote-btn-down-${reqId}"
              onclick="handleVote(${reqId}, 'down', event)">👎 <span id="vote-down-${reqId}">${voteData.down}</span></button>
    </div>` : '';

  const innerContent = `
    <div class="req-name-row">
      <span class="req-name">${escHtml(req.요구사항명)}</span>${commentBtnHtml}
    </div>
    ${req.설명 ? `<div class="req-desc" id="desc-${idx}">${escHtml(req.설명)}</div>
      <span class="req-desc-toggle" onclick="toggleDesc(${idx})">더보기</span>` : ''}`;

  const nameCell = isChild
    ? `<div class="req-child-indent">
         <span class="tree-connector">ㄴ</span>
         <div style="flex:1">${innerContent}</div>
       </div>`
    : innerContent;

  return `
  <tr class="${isChild ? 'req-child-row' : 'req-standalone-row'}" data-idx="${idx}">
    <td style="width:28px"></td>
    <td style="text-align:center">
      <span class="badge badge-${badge}">${req.우선순위 || ''}</span>
    </td>
    <td>${nameCell}</td>
    <td><span class="badge badge-type">${escHtml(req.유형 || '')}</span></td>
    <td>${engagementCell}</td>
    <td>
      <div class="row-actions">
        <button class="btn btn-secondary btn-sm" onclick="openEditModal(${idx})">수정</button>
        <button class="btn btn-danger btn-sm" onclick="deleteReq(${idx})">삭제</button>
      </div>
    </td>
  </tr>`;
}

function statusClass(s) {
  return { '확정': 'done', '검토중': 'review', '보류': 'hold', '삭제예정': 'del' }[s] || 'none';
}

// 상위 요구사항 이름 수정 (모든 하위 항목의 상위요구사항 필드 일괄 변경)
function openEditParentModal(groupId, groupName) {
  const newName = prompt(`상위 요구사항 이름 변경\n현재: ${groupName}`, groupName);
  if (newName === null || !newName.trim()) return;
  state.requirements.forEach(r => {
    if (String(r.상위요구사항ID || '').trim() === groupId) {
      r.상위요구사항 = newName.trim();
    }
  });
  setDirty(true);
  renderRequirements();
  showToast('상위 요구사항 이름이 변경됐어요.');
}

// 상위 요구사항 그룹 해제 (하위 항목들의 상위요구사항ID/상위요구사항 초기화)
function unlinkParentGroup(groupId) {
  const count = state.requirements.filter(r =>
    String(r.상위요구사항ID || '').trim() === groupId).length;
  if (!confirm(`상위 요구사항 그룹 연결을 해제할까요?\n연결된 ${count}개 상세 요구사항이 미분류로 이동해요.`)) return;
  state.requirements.forEach(r => {
    if (String(r.상위요구사항ID || '').trim() === groupId) {
      r.상위요구사항ID = '';
      r.상위요구사항   = '';
    }
  });
  setDirty(true);
  renderRequirements();
  renderStats();
  showToast('🔓 그룹 연결이 해제됐어요.');
}


function toggleDesc(idx) {
  const el = document.getElementById(`desc-${idx}`);
  const toggle = el.nextElementSibling;
  if (el.classList.toggle('expanded')) {
    toggle.textContent = '접기';
  } else {
    toggle.textContent = '더보기';
  }
}

function escHtml(s) {
  if (!s) return '';
  return String(s)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}

// ─── 요구사항 CRUD ────────────────────────────────────────
function addReq(data) {
  state.requirements.push({ ...data, 번호: 0 });
  setDirty(true);
  renderRequirements();
  renderStats();
}

function updateReq(idx, data) {
  state.requirements[idx] = { ...state.requirements[idx], ...data };
  setDirty(true);
  renderRequirements();
  renderStats();
}

function deleteReq(idx) {
  if (!confirm('이 요구사항을 삭제할까요?')) return;
  state.requirements.splice(idx, 1);
  setDirty(true);
  renderRequirements();
  renderStats();
}

// ─── 저장 ─────────────────────────────────────────────────
async function saveRequirements() {
  const btn = document.getElementById('btn-save');
  const orig = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<div class="spinner" style="width:16px;height:16px;border-width:2px;display:inline-block;margin-right:6px"></div>저장 중...';

  try {
    // 저장 전 그룹 내 우선순위 순으로 재정렬
    const { groups, standalone } = buildHierarchy();
    const sortedReqs = [];
    groups.forEach(g => sortedReqs.push(...sortRequirements(g.children)));
    sortedReqs.push(...sortRequirements(standalone));

    // 모듈 변경된 항목 분리
    const stayReqs  = sortedReqs.filter(r => !r.모듈 || r.모듈 === state.currentModule);
    const movedReqs = sortedReqs.filter(r => r.모듈 && r.모듈 !== state.currentModule);

    // 현재 모듈 저장
    await SheetsSync.saveRequirements(state.currentModule, stayReqs);

    // 다른 모듈로 이동한 항목 처리 (기존 데이터에 병합 후 저장)
    if (movedReqs.length) {
      const byModule = {};
      movedReqs.forEach(r => {
        if (!byModule[r.모듈]) byModule[r.모듈] = [];
        byModule[r.모듈].push(r);
      });
      for (const [mod, reqs] of Object.entries(byModule)) {
        const { requirements: existing } = await SheetsSync.getRequirements(mod);
        await SheetsSync.saveRequirements(mod, [...existing, ...reqs]);
      }
    }

    state.requirements = stayReqs;
    state.savedRequirements = deepClone(stayReqs);
    setDirty(false);
    localStorage.removeItem(_summaryKey(state.currentModule)); // 요약 캐시 초기화
    renderRequirements();
    renderStats();

    const movedMsg = movedReqs.length ? ` (${movedReqs.length}개 다른 모듈로 이동)` : '';
    showToast(`✅ 저장 완료! 우선순위 순으로 자동 정렬됐어요.${movedMsg}`);
  } catch (err) {
    showToast('❌ 저장 실패: ' + err.message, 4000);
  } finally {
    btn.disabled = false;
    btn.innerHTML = orig;
  }
}

// ─── 뒤로 가기 ────────────────────────────────────────────
function goHome() {
  if (state.isDirty) {
    showExitAlert(() => loadHome());
  } else {
    loadHome();
  }
}

// ─── 얼럿 팝업 ────────────────────────────────────────────
let _exitCallback = null;

function showExitAlert(callback) {
  _exitCallback = callback;
  document.getElementById('exit-alert').classList.add('active');
}

function exitWithoutSave() {
  document.getElementById('exit-alert').classList.remove('active');
  setDirty(false);
  if (_exitCallback) { _exitCallback(); _exitCallback = null; }
}

async function exitWithSave() {
  document.getElementById('exit-alert').classList.remove('active');
  await saveRequirements();
  if (_exitCallback) { _exitCallback(); _exitCallback = null; }
}

// ─── 수정/추가 모달 ───────────────────────────────────────
let _editIdx = null; // null = 신규

function openEditModal(idx = null) {
  _editIdx = idx;
  const req = idx !== null ? state.requirements[idx] : {};

  document.getElementById('edit-modal-title').textContent =
    idx !== null ? '요구사항 수정' : '요구사항 추가';

  document.getElementById('edit-name').value     = req.요구사항명 || '';
  document.getElementById('edit-desc').value     = req.설명 || '';
  document.getElementById('edit-type').value     = req.유형 || '기능';
  document.getElementById('edit-priority').value = req.우선순위 || 'P2';
  document.getElementById('edit-area').value     = req.영역 || '';
  document.getElementById('edit-author').value   = req.작성자 || '';
  document.getElementById('edit-assignee').value = req.담당자 || '';
  document.getElementById('edit-status').value   = req.검토현황 || '';
  document.getElementById('edit-source').value   = req.출처 || '';
  document.getElementById('edit-note').value     = req.비고 || '';
  document.getElementById('edit-error').textContent = '';

  // 모듈 드롭다운 채우기
  _populateModuleSelector(req.모듈 || state.currentModule);

  // 상위 요구사항 그룹 드롭다운 채우기
  _populateGroupSelector(req.상위요구사항ID || '', req.상위요구사항 || '');
  document.getElementById('new-group-fields').style.display = 'none';

  document.getElementById('modal-overlay').classList.add('active');
  document.getElementById('edit-modal').style.display = 'flex';
  document.getElementById('analysis-modal').style.display = 'none';
  document.getElementById('edit-name').focus();
}

function _populateModuleSelector(selected) {
  const sel = document.getElementById('edit-module');
  sel.innerHTML = '';
  [...state.modules]
    .sort((a, b) => getModuleSortKey(a) - getModuleSortKey(b))
    .forEach(m => {
      const opt = document.createElement('option');
      opt.value = m;
      opt.textContent = `${moduleCode(m)} — ${moduleName(m)}`;
      if (m === selected) opt.selected = true;
      sel.appendChild(opt);
    });
}

function _populateGroupSelector(selectedId, selectedName) {
  const sel = document.getElementById('edit-parent-group');
  // 기존 동적 옵션만 제거 (첫 번째 "없음"과 마지막 "새 그룹" 유지)
  while (sel.options.length > 1) sel.remove(1);

  // 현재 데이터에서 유니크 그룹 추출
  const { groups } = buildHierarchy();
  groups.forEach(g => {
    const opt = document.createElement('option');
    opt.value = g.id;
    opt.textContent = `${g.name} (${g.children.length}개)`;
    if (g.id === selectedId) opt.selected = true;
    sel.insertBefore(opt, sel.lastElementChild); // "새 그룹" 앞에 삽입
  });

  // selectedId가 기존 그룹에 없으면 "없음" 선택
  if (!selectedId) sel.value = '';

  // "새 그룹" 옵션 추가
  if (!sel.querySelector('[value="__new__"]')) {
    const newOpt = document.createElement('option');
    newOpt.value = '__new__';
    newOpt.textContent = '+ 새 그룹 직접 입력';
    sel.appendChild(newOpt);
  }

  // 새 그룹 입력 필드 초기화
  document.getElementById('edit-new-group-id').value   = selectedId && !groups.find(g => g.id === selectedId) ? selectedId : '';
  document.getElementById('edit-new-group-name').value = selectedName && !groups.find(g => g.id === selectedId) ? selectedName : '';
}

function handleParentGroupChange() {
  const val = document.getElementById('edit-parent-group').value;
  document.getElementById('new-group-fields').style.display = val === '__new__' ? 'block' : 'none';
}

function closeEditModal() {
  document.getElementById('modal-overlay').classList.remove('active');
  document.getElementById('edit-modal').style.display = 'none';
}

function submitEditModal() {
  const name = document.getElementById('edit-name').value.trim();
  if (!name) {
    document.getElementById('edit-error').textContent = '요구사항명은 필수 입력 항목이에요.';
    document.getElementById('edit-name').focus();
    return;
  }

  // 상위 요구사항 그룹 처리
  const groupSel = document.getElementById('edit-parent-group').value;
  let 상위요구사항ID = '';
  let 상위요구사항   = '';

  if (groupSel === '__new__') {
    상위요구사항ID = document.getElementById('edit-new-group-id').value.trim();
    상위요구사항   = document.getElementById('edit-new-group-name').value.trim();
    if (!상위요구사항ID) {
      document.getElementById('edit-error').textContent = '새 그룹 ID를 입력해주세요.';
      return;
    }
  } else if (groupSel) {
    상위요구사항ID = groupSel;
    // 그룹 이름은 buildHierarchy에서 확인
    const { groups } = buildHierarchy();
    const g = groups.find(g => g.id === groupSel);
    상위요구사항 = g ? g.name : groupSel;
  }

  const data = {
    모듈:       document.getElementById('edit-module').value || state.currentModule,
    요구사항명: name,
    설명:       document.getElementById('edit-desc').value.trim(),
    유형:       document.getElementById('edit-type').value,
    우선순위:   document.getElementById('edit-priority').value,
    영역:       document.getElementById('edit-area').value,
    작성자:     document.getElementById('edit-author').value.trim(),
    담당자:     document.getElementById('edit-assignee').value.trim(),
    검토현황:   document.getElementById('edit-status').value,
    출처:       document.getElementById('edit-source').value.trim(),
    비고:       document.getElementById('edit-note').value.trim(),
    상위요구사항ID,
    상위요구사항,
  };

  if (_editIdx !== null) {
    updateReq(_editIdx, data);
    showToast('요구사항이 수정됐어요.');
  } else {
    addReq(data);
    showToast('새 요구사항이 추가됐어요.');
  }

  closeEditModal();
}

// ─── 분석 모달 ────────────────────────────────────────────
let _analysisType = null;
let _analysisPairs = [];

function openAnalysisModal(type) {
  _analysisType = type;
  _analysisPairs = [];

  const title = type === 'duplicate' ? '비슷한 요건 찾기' : '충돌 요건 찾기';
  document.getElementById('analysis-modal-title').textContent = title;
  document.getElementById('analysis-modal-subtitle').textContent =
    type === 'duplicate'
      ? '텍스트 유사도 분석으로 겹치는 요구사항 쌍을 찾아드려요.'
      : 'AI(Gemini)가 의미를 이해해서 논리적으로 상충하는 쌍을 찾아드려요.';

  document.getElementById('modal-overlay').classList.add('active');
  document.getElementById('edit-modal').style.display = 'none';
  document.getElementById('analysis-modal').style.display = 'flex';

  const body = document.getElementById('analysis-body');
  body.innerHTML = `<div class="analysis-loading"><div class="spinner"></div><p>분석 중...</p></div>`;

  if (type === 'conflict') {
    // 충돌: Gemini AI 의미 분석 (비동기)
    SheetsSync.analyze(state.requirements, 'conflict')
      .then(result => {
        _analysisPairs = result.pairs || [];
        renderAnalysisPairs(type);
      })
      .catch(err => {
        body.innerHTML = `<div class="error-banner">AI 분석 실패: ${err.message}<br><small style="opacity:.7">Apps Script에 OPENAI_API_KEY가 설정되어 있는지 확인해주세요.</small></div>`;
      });
  } else {
    // 중복: 로컬 n-gram 유사도 분석
    setTimeout(() => {
      try {
        const result = ReqAnalyzer.detectDuplicates(state.requirements);
        _analysisPairs = result.pairs || [];
        renderAnalysisPairs(type);
      } catch (err) {
        body.innerHTML = `<div class="error-banner">분석 중 오류가 발생했어요: ${err.message}</div>`;
      }
    }, 50);
  }
}

function renderAnalysisPairs(type) {
  const body = document.getElementById('analysis-body');

  if (!_analysisPairs.length) {
    const msg = type === 'duplicate'
      ? '중복되는 요구사항이 없어요. 요건 정리가 잘 됐네요! 👏'
      : '상충되는 요구사항이 없어요. 요건 간 충돌이 없군요! 👏';
    body.innerHTML = `
      <div class="analysis-empty">
        <div class="icon">✅</div>
        <p>${msg}</p>
      </div>`;
    return;
  }

  body.innerHTML = `
    <p style="font-size:.875rem;color:var(--text-sub);margin-bottom:16px">
      ${_analysisPairs.length}개의 ${type === 'duplicate' ? '유사/중복' : '상충'} 쌍이 발견됐어요.
      필요한 항목을 수정하거나 삭제해보세요.
    </p>
    ${_analysisPairs.map((pair, i) => renderPairItem(pair, i, type)).join('')}
  `;
}

function renderPairItem(pair, pairIdx, type) {
  const idxA = state.requirements.indexOf(pair.item_a);
  const idxB = state.requirements.indexOf(pair.item_b);

  return `
  <div class="pair-item" id="pair-${pairIdx}">
    <div class="pair-cards">
      <div class="pair-req-card">
        <span class="badge badge-${(pair.item_a.우선순위||'').toLowerCase()}" style="margin-bottom:4px">${pair.item_a.우선순위||''}</span>
        <div class="pair-req-name">${escHtml(pair.item_a.요구사항명)}</div>
        ${pair.item_a.설명 ? `<div class="pair-req-desc">${escHtml(pair.item_a.설명)}</div>` : ''}
      </div>
      <div class="pair-connector">↔</div>
      <div class="pair-req-card">
        <span class="badge badge-${(pair.item_b.우선순위||'').toLowerCase()}" style="margin-bottom:4px">${pair.item_b.우선순위||''}</span>
        <div class="pair-req-name">${escHtml(pair.item_b.요구사항명)}</div>
        ${pair.item_b.설명 ? `<div class="pair-req-desc">${escHtml(pair.item_b.설명)}</div>` : ''}
      </div>
    </div>
    <div class="pair-reason ${type === 'conflict' ? 'conflict' : ''}">
      <span>${type === 'duplicate' ? '💡' : '⚠️'}</span>
      <span>${escHtml(pair.reason)}</span>
    </div>
    <div class="pair-actions">
      ${idxA !== -1 ? `<button class="btn btn-secondary btn-sm" onclick="openEditModal(${idxA})">A 수정</button>` : ''}
      ${idxA !== -1 ? `<button class="btn btn-danger btn-sm" onclick="deleteReqFromAnalysis(${idxA}, ${pairIdx})">A 삭제</button>` : ''}
      ${idxB !== -1 ? `<button class="btn btn-secondary btn-sm" onclick="openEditModal(${idxB})">B 수정</button>` : ''}
      ${idxB !== -1 ? `<button class="btn btn-danger btn-sm" onclick="deleteReqFromAnalysis(${idxB}, ${pairIdx})">B 삭제</button>` : ''}
    </div>
  </div>`;
}

function deleteReqFromAnalysis(reqIdx, pairIdx) {
  if (!confirm('이 요구사항을 삭제할까요?')) return;
  const deleted = state.requirements[reqIdx];
  state.requirements.splice(reqIdx, 1);
  setDirty(true);

  // 쌍 목록에서 해당 항목이 포함된 쌍 제거
  _analysisPairs = _analysisPairs.filter(p => p.item_a !== deleted && p.item_b !== deleted);
  renderAnalysisPairs(_analysisType);
  renderRequirements();
  renderStats();
  showToast('요구사항이 삭제됐어요.');
}

function closeAnalysisModal() {
  document.getElementById('modal-overlay').classList.remove('active');
  document.getElementById('analysis-modal').style.display = 'none';
}

// ─── 투표 ─────────────────────────────────────────────────
async function handleVote(reqId, voteType, event) {
  event && event.stopPropagation();
  const prev = localStorage.getItem(`speclens_vote_${reqId}`) || '';

  let upDelta = 0, downDelta = 0;
  if (voteType === 'up') {
    if (prev === 'up')        { upDelta = -1; localStorage.removeItem(`speclens_vote_${reqId}`); }
    else if (prev === 'down') { upDelta = 1; downDelta = -1; localStorage.setItem(`speclens_vote_${reqId}`, 'up'); }
    else                      { upDelta = 1; localStorage.setItem(`speclens_vote_${reqId}`, 'up'); }
  } else {
    if (prev === 'down')      { downDelta = -1; localStorage.removeItem(`speclens_vote_${reqId}`); }
    else if (prev === 'up')   { upDelta = -1; downDelta = 1; localStorage.setItem(`speclens_vote_${reqId}`, 'down'); }
    else                      { downDelta = 1; localStorage.setItem(`speclens_vote_${reqId}`, 'down'); }
  }

  // 낙관적 UI 업데이트
  const votes = state.votes[String(reqId)] || { up: 0, down: 0 };
  votes.up   = Math.max(0, votes.up   + upDelta);
  votes.down = Math.max(0, votes.down + downDelta);
  state.votes[String(reqId)] = votes;

  const upEl   = document.getElementById(`vote-up-${reqId}`);
  const downEl = document.getElementById(`vote-down-${reqId}`);
  if (upEl)   upEl.textContent   = votes.up;
  if (downEl) downEl.textContent = votes.down;

  const newVote = localStorage.getItem(`speclens_vote_${reqId}`) || '';
  document.getElementById(`vote-btn-up-${reqId}`)?.classList.toggle('voted-up',   newVote === 'up');
  document.getElementById(`vote-btn-down-${reqId}`)?.classList.toggle('voted-down', newVote === 'down');

  const req = state.requirements.find(r => String(r.번호) === String(reqId));
  const reqName = req ? req.요구사항명 : '';

  try {
    const result = await SheetsSync.submitVote(reqId, reqName, upDelta, downDelta);
    state.votes[String(reqId)] = result;
    if (upEl)   upEl.textContent   = result.up;
    if (downEl) downEl.textContent = result.down;
  } catch (err) {
    showToast('투표 저장 실패: ' + err.message, 3000);
  }
}

// ─── 코멘트 ───────────────────────────────────────────────
let _commentReqId = null;

function openCommentModal(reqId, event) {
  event && event.stopPropagation();
  _commentReqId = reqId;

  const req = state.requirements.find(r => String(r.번호) === String(reqId));
  document.getElementById('comment-modal-title').textContent =
    req ? req.요구사항명 : '코멘트';
  document.getElementById('comment-input').value = '';
  document.getElementById('comment-list').innerHTML =
    '<div class="loading-wrap"><div class="spinner"></div></div>';

  document.getElementById('modal-overlay').classList.add('active');
  document.getElementById('edit-modal').style.display     = 'none';
  document.getElementById('analysis-modal').style.display = 'none';
  document.getElementById('comment-modal').style.display  = 'flex';

  loadComments(reqId);
}

async function loadComments(reqId) {
  try {
    const { comments } = await SheetsSync.getComments(reqId);
    renderCommentList(comments);
  } catch (err) {
    document.getElementById('comment-list').innerHTML =
      `<div class="error-banner">불러오기 실패: ${err.message}</div>`;
  }
}

function renderCommentList(comments) {
  const el = document.getElementById('comment-list');
  if (!comments.length) {
    el.innerHTML = '<div style="text-align:center;padding:32px;color:var(--text-muted)">아직 코멘트가 없어요.<br>첫 코멘트를 남겨보세요!</div>';
    return;
  }
  el.innerHTML = comments.map(c => `
    <div class="comment-item" id="cmt-${escHtml(c.id)}">
      <div class="comment-text">${escHtml(c.text)}</div>
      <div class="comment-meta">
        <span class="comment-time">${formatCommentTime(c.timestamp)}</span>
        <button class="btn btn-ghost btn-sm" onclick="handleDeleteComment('${escHtml(c.id)}')">삭제</button>
      </div>
    </div>`).join('');
}

function formatCommentTime(ts) {
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return ts; }
}

async function submitComment() {
  const text = document.getElementById('comment-input').value.trim();
  if (!text || !_commentReqId) return;
  const btn = document.querySelector('#comment-modal .modal-footer .btn-primary');
  if (btn) btn.disabled = true;

  const commentReq = state.requirements.find(r => String(r.번호) === String(_commentReqId));
  const commentReqName = commentReq ? commentReq.요구사항명 : '';

  try {
    await SheetsSync.addComment(_commentReqId, commentReqName, text);
    document.getElementById('comment-input').value = '';

    const rid = String(_commentReqId);
    state.commentCounts[rid] = (state.commentCounts[rid] || 0) + 1;
    const cnt = state.commentCounts[rid];

    const btnEl = document.getElementById(`comment-btn-${rid}`);
    if (btnEl) {
      btnEl.classList.add('has-comments');
      btnEl.innerHTML = `💬 <span class="comment-count" id="comment-count-${rid}">${cnt}</span>`;
    }

    await loadComments(_commentReqId);
    showToast('코멘트가 등록됐어요.');
  } catch (err) {
    showToast('등록 실패: ' + err.message, 3000);
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function handleDeleteComment(commentId) {
  if (!confirm('이 코멘트를 삭제할까요?')) return;
  try {
    await SheetsSync.deleteComment(commentId);

    const rid = String(_commentReqId);
    state.commentCounts[rid] = Math.max(0, (state.commentCounts[rid] || 1) - 1);
    const cnt = state.commentCounts[rid];

    const btnEl = document.getElementById(`comment-btn-${rid}`);
    if (btnEl) {
      if (cnt === 0) {
        btnEl.classList.remove('has-comments');
        btnEl.innerHTML = '💬';
      } else {
        const cntEl = document.getElementById(`comment-count-${rid}`);
        if (cntEl) cntEl.textContent = cnt;
      }
    }

    document.getElementById(`cmt-${commentId}`)?.remove();
    const listEl = document.getElementById('comment-list');
    if (listEl && !listEl.querySelector('.comment-item')) {
      listEl.innerHTML = '<div style="text-align:center;padding:32px;color:var(--text-muted)">아직 코멘트가 없어요.<br>첫 코멘트를 남겨보세요!</div>';
    }
    showToast('코멘트가 삭제됐어요.');
  } catch (err) {
    showToast('삭제 실패: ' + err.message, 3000);
  }
}

function closeCommentModal() {
  document.getElementById('modal-overlay').classList.remove('active');
  document.getElementById('comment-modal').style.display = 'none';
  _commentReqId = null;
}

function showError(elId, msg) {
  const el = document.getElementById(elId);
  if (el) el.textContent = msg;
}

// ─── 초기화 ───────────────────────────────────────────────
function init() {
  if (SheetsSync.isConfigured()) {
    loadHome();
  } else {
    renderConfig();
  }

  // 브라우저 닫기/새로고침 경고
  window.addEventListener('beforeunload', (e) => {
    if (state.isDirty) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
}

document.addEventListener('DOMContentLoaded', init);
