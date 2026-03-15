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
};

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
    document.getElementById(sid).style.display = sid === id ? 'block' : 'none';
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
    '<tr><td colspan="5" class="loading-wrap"><div class="spinner"></div><p>요구사항을 불러오는 중...</p></td></tr>';
  document.getElementById('module-stats').innerHTML = '';

  try {
    const { requirements } = await SheetsSync.getRequirements(module);
    state.requirements = requirements;
    state.savedRequirements = deepClone(requirements);
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

function renderRequirements() {
  const sorted = sortRequirements(state.requirements);
  const tbody = document.getElementById('req-table-body');

  if (!sorted.length) {
    tbody.innerHTML = `
      <tr><td colspan="5" style="text-align:center;padding:48px;color:var(--text-muted)">
        아직 요구사항이 없어요. 첫 요구사항을 추가해보세요!
      </td></tr>`;
    return;
  }

  tbody.innerHTML = sorted.map((req, idx) => {
    const realIdx = state.requirements.indexOf(req);
    return `
    <tr data-idx="${realIdx}">
      <td style="width:60px;text-align:center">
        <span class="badge badge-${req.우선순위.toLowerCase()}">${req.우선순위}</span>
      </td>
      <td>
        <div class="req-name">${escHtml(req.요구사항명)}</div>
        ${req.설명 ? `
          <div class="req-desc" id="desc-${realIdx}">${escHtml(req.설명)}</div>
          <span class="req-desc-toggle" onclick="toggleDesc(${realIdx})">더보기</span>
        ` : ''}
      </td>
      <td style="width:80px">
        <span class="badge badge-type">${escHtml(req.유형 || '')}</span>
      </td>
      <td style="width:50px;color:var(--text-muted);font-size:.8rem">${escHtml(req.영역 || '')}</td>
      <td style="width:80px">
        <div class="row-actions">
          <button class="btn btn-secondary btn-sm" onclick="openEditModal(${realIdx})">수정</button>
          <button class="btn btn-danger btn-sm" onclick="deleteReq(${realIdx})">삭제</button>
        </div>
      </td>
    </tr>`;
  }).join('');
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
    await SheetsSync.saveRequirements(state.currentModule, state.requirements);
    state.savedRequirements = deepClone(state.requirements);
    setDirty(false);
    showToast('✅ 변경사항이 저장됐어요!');
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

  document.getElementById('edit-name').value   = req.요구사항명 || '';
  document.getElementById('edit-desc').value   = req.설명 || '';
  document.getElementById('edit-type').value   = req.유형 || '기능';
  document.getElementById('edit-priority').value = req.우선순위 || 'P2';
  document.getElementById('edit-area').value   = req.영역 || '';
  document.getElementById('edit-ch-world').checked    = req.채널_월드     === 'Y';
  document.getElementById('edit-ch-direct').checked   = req.채널_다이렉트 === 'Y';
  document.getElementById('edit-ch-space').checked    = req.채널_우주     === 'Y';
  document.getElementById('edit-ch-members').checked  = req.채널_멤버십   === 'Y';
  document.getElementById('edit-source').value  = req.출처 || '';
  document.getElementById('edit-author').value  = req.작성자 || '';
  document.getElementById('edit-error').textContent = '';

  document.getElementById('modal-overlay').classList.add('active');
  document.getElementById('edit-modal').style.display = 'flex';
  document.getElementById('analysis-modal').style.display = 'none';
  document.getElementById('edit-name').focus();
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

  const data = {
    요구사항명: name,
    설명:       document.getElementById('edit-desc').value.trim(),
    유형:       document.getElementById('edit-type').value,
    우선순위:   document.getElementById('edit-priority').value,
    영역:       document.getElementById('edit-area').value,
    채널_월드:     document.getElementById('edit-ch-world').checked   ? 'Y' : 'N',
    채널_다이렉트: document.getElementById('edit-ch-direct').checked  ? 'Y' : 'N',
    채널_우주:     document.getElementById('edit-ch-space').checked   ? 'Y' : 'N',
    채널_멤버십:   document.getElementById('edit-ch-members').checked ? 'Y' : 'N',
    출처:   document.getElementById('edit-source').value.trim(),
    작성자: document.getElementById('edit-author').value.trim(),
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
      : '키워드 패턴 분석으로 서로 충돌하는 요구사항 쌍을 찾아드려요.';

  document.getElementById('modal-overlay').classList.add('active');
  document.getElementById('edit-modal').style.display = 'none';
  document.getElementById('analysis-modal').style.display = 'flex';

  const body = document.getElementById('analysis-body');
  body.innerHTML = `<div class="analysis-loading"><div class="spinner"></div><p>분석 중...</p></div>`;

  // 로컬 분석 — API 불필요, 동기 실행
  setTimeout(() => {
    try {
      const result = type === 'duplicate'
        ? ReqAnalyzer.detectDuplicates(state.requirements)
        : ReqAnalyzer.detectConflicts(state.requirements);
      _analysisPairs = result.pairs || [];
      renderAnalysisPairs(type);
    } catch (err) {
      body.innerHTML = `<div class="error-banner">분석 중 오류가 발생했어요: ${err.message}</div>`;
    }
  }, 50); // 스피너가 잠깐 보이도록 50ms 지연
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
