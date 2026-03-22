// =============================================================
// SpecLens — Google Apps Script Backend
// =============================================================
// 이 파일을 Google Apps Script 편집기에 붙여넣고
// 웹 앱으로 배포하세요. (하단 SETUP.md 참고)
// =============================================================

const SPREADSHEET_ID    = '1tj1JTdh0XT7x2IKRDTePwRRMyBrqGo6RiOEtmrH_R8Y';
const SHEET_NAME        = 'Next플랫폼기획 2팀';
const VOTES_SHEET_NAME  = '투표';
const COMMENTS_SHEET_NAME = '코멘트';

// 컬럼 인덱스 (0-based)
// 번호 | 모듈 | 영역 | 상위요구사항ID | 상위요구사항 | 요구사항ID | 요구사항명 |
// 설명 | 유형 | 우선순위 | 출처 | 작성자 | 구ID | 담당자 | 수정/삭제 | 검토현황 | 비고
const COL = {
  번호: 0,
  모듈: 1,
  영역: 2,
  상위요구사항ID: 3,
  상위요구사항: 4,
  요구사항ID: 5,
  요구사항명: 6,
  설명: 7,
  유형: 8,
  우선순위: 9,
  출처: 10,
  작성자: 11,
  구ID: 12,
  담당자: 13,
  수정삭제: 14,
  검토현황: 15,
  비고: 16,
};

// ─── HTTP 응답 헬퍼 ────────────────────────────────────────
function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// ─── 진입점 ───────────────────────────────────────────────
function doGet(e) {
  try {
    const action = e.parameter.action;
    if (action === 'getModules')       return jsonResponse(getModules());
    if (action === 'getRequirements')  return jsonResponse(getRequirements(e.parameter.module));
    if (action === 'getVotes')         return jsonResponse(getVotes());
    if (action === 'getCommentCounts') return jsonResponse(getCommentCounts());
    if (action === 'getComments')      return jsonResponse(getComments(e.parameter.reqId));
    if (action === 'getModuleSummary') return jsonResponse(getModuleSummary(e.parameter.module));
    return jsonResponse({ error: '알 수 없는 요청입니다.' });
  } catch (err) {
    return jsonResponse({ error: err.message });
  }
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    if (data.action === 'save')          return jsonResponse(saveRequirements(data.module, data.requirements));
    if (data.action === 'analyze')       return jsonResponse(analyzeWithGemini(data.requirements, data.type));
    if (data.action === 'vote')          return jsonResponse(submitVote(data.reqId, data.reqName, data.upDelta, data.downDelta));
    if (data.action === 'addComment')    return jsonResponse(addComment(data.reqId, data.reqName, data.text));
    if (data.action === 'deleteComment') return jsonResponse(deleteComment(data.commentId));
    return jsonResponse({ error: '알 수 없는 요청입니다.' });
  } catch (err) {
    return jsonResponse({ error: err.message });
  }
}

// ─── Skill 1: sheets-sync ─────────────────────────────────
function getSheet() {
  return SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_NAME);
}

function rowToReq(row, rowIdx) {
  return {
    _row:       rowIdx,
    번호:       row[COL.번호],
    모듈:       String(row[COL.모듈]).trim(),
    영역:       row[COL.영역],
    상위요구사항ID: String(row[COL.상위요구사항ID] || '').trim(),
    상위요구사항:   String(row[COL.상위요구사항]   || '').trim(),
    요구사항ID: row[COL.요구사항ID],
    요구사항명: row[COL.요구사항명],
    설명:       row[COL.설명],
    유형:       row[COL.유형],
    우선순위:   row[COL.우선순위],
    출처:       row[COL.출처],
    작성자:     row[COL.작성자],
    구ID:       row[COL.구ID],
    담당자:     row[COL.담당자],
    수정삭제:   row[COL.수정삭제],
    검토현황:   row[COL.검토현황],
    비고:       row[COL.비고],
  };
}

function getModules() {
  const data = getSheet().getDataRange().getValues();
  const seen = new Set();
  const modules = [];
  const counts = {};  // 모듈별 요구사항 수
  for (let i = 1; i < data.length; i++) {
    const m = String(data[i][COL.모듈]).trim();
    if (!m) continue;
    if (!seen.has(m)) { seen.add(m); modules.push(m); }
    counts[m] = (counts[m] || 0) + 1;
  }
  const total = Object.values(counts).reduce((s, n) => s + n, 0);
  return { modules, counts, total };
}

function getRequirements(module) {
  const data = getSheet().getDataRange().getValues();
  const reqs = [];
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][COL.모듈]).trim() === module) {
      reqs.push(rowToReq(data[i], i + 1));
    }
  }
  const order = { P1: 1, P2: 2, P3: 3 };
  reqs.sort((a, b) => (order[a.우선순위] || 9) - (order[b.우선순위] || 9));
  return { requirements: reqs };
}

function saveRequirements(module, requirements) {
  const sheet = getSheet();
  const allData = sheet.getDataRange().getValues();

  // 이 모듈의 행 삭제 (아래에서 위로)
  const toDelete = [];
  for (let i = 1; i < allData.length; i++) {
    if (String(allData[i][COL.모듈]).trim() === module) toDelete.push(i + 1);
  }
  for (let i = toDelete.length - 1; i >= 0; i--) sheet.deleteRow(toDelete[i]);

  // 삭제 후 전체 번호 최댓값 계산 (신규 항목 번호 부여용)
  const remaining = sheet.getDataRange().getValues();
  let maxNum = 0;
  for (let i = 1; i < remaining.length; i++) {
    const n = Number(remaining[i][COL.번호]);
    if (!isNaN(n) && n > maxNum) maxNum = n;
  }
  // 기존 요구사항의 번호도 고려
  requirements.forEach(r => {
    const n = Number(r.번호);
    if (!isNaN(n) && n > maxNum) maxNum = n;
  });

  let newIdCounter = maxNum;
  requirements.forEach(req => {
    const num = Number(req.번호);
    const rowNum = (!req.번호 || isNaN(num) || num <= 0) ? ++newIdCounter : num;
    sheet.appendRow([
      rowNum,                      // 0: 번호
      req.모듈       || module,    // 1: 모듈
      req.영역       || '',        // 2: 영역
      req.상위요구사항ID || '',    // 3: 상위요구사항ID
      req.상위요구사항   || '',    // 4: 상위요구사항
      req.요구사항ID     || '',    // 5: 요구사항ID
      req.요구사항명     || '',    // 6: 요구사항명
      req.설명           || '',    // 7: 설명
      req.유형           || '기능',// 8: 유형
      req.우선순위       || 'P2',  // 9: 우선순위
      req.출처           || '',    // 10: 출처
      req.작성자         || '',    // 11: 작성자
      req.구ID           || '',    // 12: 구ID
      req.담당자         || '',    // 13: 담당자
      req.수정삭제       || '',    // 14: 수정/삭제
      req.검토현황       || '',    // 15: 검토현황
      req.비고           || '',    // 16: 비고
    ]);
  });

  return { success: true, saved: requirements.length };
}

// ─── Skill 3: 투표 ────────────────────────────────────────
// 투표 시트: 요구사항번호(0) | 👍(1) | 👎(2)

function getOrCreateVotesSheet() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(VOTES_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(VOTES_SHEET_NAME);
    sheet.appendRow(['요구사항번호', '요구사항명', '투표 (추천/비추천)']);
  }
  return sheet;
}

// 투표값 형식: "추천수/비추천수" (예: "3/2"), 칼럼: 요구사항번호(0) | 요구사항명(1) | 투표(2)
function getVotes() {
  const sheet = getOrCreateVotesSheet();
  const data = sheet.getDataRange().getValues();
  const votes = {};
  for (let i = 1; i < data.length; i++) {
    const reqId = String(data[i][0]);
    if (!reqId) continue;
    const parts = String(data[i][2] || '0/0').split('/');
    votes[reqId] = { up: parseInt(parts[0]) || 0, down: parseInt(parts[1]) || 0 };
  }
  return { votes };
}

function submitVote(reqId, reqName, upDelta, downDelta) {
  const sheet = getOrCreateVotesSheet();
  const data = sheet.getDataRange().getValues();
  const reqIdStr = String(reqId);
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === reqIdStr) {
      const parts   = String(data[i][2] || '0/0').split('/');
      const newUp   = Math.max(0, (parseInt(parts[0]) || 0) + Number(upDelta));
      const newDown = Math.max(0, (parseInt(parts[1]) || 0) + Number(downDelta));
      sheet.getRange(i + 1, 3).setValue(`${newUp}/${newDown}`);
      return { up: newUp, down: newDown };
    }
  }
  const newUp   = Math.max(0, Number(upDelta));
  const newDown = Math.max(0, Number(downDelta));
  sheet.appendRow([reqIdStr, reqName || '', `${newUp}/${newDown}`]);
  return { up: newUp, down: newDown };
}

// ─── Skill 4: 코멘트 ──────────────────────────────────────
// 코멘트 시트: ID(0) | 요구사항번호(1) | 내용(2) | 작성시각(3)

function getOrCreateCommentsSheet() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(COMMENTS_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(COMMENTS_SHEET_NAME);
    sheet.appendRow(['요구사항번호', '요구사항명', '내용', '작성시각']);
  }
  return sheet;
}

// 칼럼: 요구사항번호(0) | 요구사항명(1) | 내용(2) | 작성시각(3)
function getCommentCounts() {
  const sheet = getOrCreateCommentsSheet();
  const data = sheet.getDataRange().getValues();
  const counts = {};
  for (let i = 1; i < data.length; i++) {
    const reqId = String(data[i][0]);
    if (!reqId) continue;
    counts[reqId] = (counts[reqId] || 0) + 1;
  }
  return { counts };
}

function getComments(reqId) {
  const sheet = getOrCreateCommentsSheet();
  const data = sheet.getDataRange().getValues();
  const reqIdStr = String(reqId);
  const comments = [];
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === reqIdStr) {
      const ts = data[i][3] ? new Date(data[i][3]) : null;
      comments.push({
        id:        ts ? `${reqIdStr}_${ts.getTime()}` : String(i),
        text:      String(data[i][2]),
        timestamp: ts ? ts.toISOString() : '',
      });
    }
  }
  return { comments };
}

function addComment(reqId, reqName, text) {
  const sheet = getOrCreateCommentsSheet();
  const ts = new Date();
  const id = `${reqId}_${ts.getTime()}`;
  sheet.appendRow([String(reqId), reqName || '', text, ts]);
  return { id, timestamp: ts.toISOString() };
}

function deleteComment(commentId) {
  const sheet = getOrCreateCommentsSheet();
  const data = sheet.getDataRange().getValues();
  // commentId 형식: "${reqId}_${timestampMs}"
  const parts = String(commentId).split('_');
  const reqIdStr = parts[0];
  const targetMs = Number(parts[1]);
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) !== reqIdStr) continue;
    const rowTs = data[i][3];
    const rowMs = rowTs ? new Date(rowTs).getTime() : 0;
    if (Math.abs(rowMs - targetMs) < 1000) {
      sheet.deleteRow(i + 1);
      return { success: true };
    }
  }
  return { error: '코멘트를 찾을 수 없어요.' };
}

// ─── [진단용] Gemini 연결 테스트 ──────────────────────────
// Apps Script 편집기에서 이 함수를 직접 실행하면 로그에 결과가 나타납니다.
function testGemini() {
  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  Logger.log('API Key 존재 여부: ' + (apiKey ? '있음 (' + apiKey.substring(0, 10) + '...)' : '없음!'));

  const url = 'https://generativelanguage.googleapis.com/v1/models/gemini-2.0-flash:generateContent?key=' + apiKey;
  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    headers: { 'Content-Type': 'application/json' },
    payload: JSON.stringify({ contents: [{ parts: [{ text: '안녕' }] }] }),
    muteHttpExceptions: true,
  });

  Logger.log('HTTP 상태: ' + res.getResponseCode());
  Logger.log('응답 내용: ' + res.getContentText());
}

// ─── Gemini 공통 호출 헬퍼 ────────────────────────────────
function callGemini(prompt, temperature, maxTokens) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!apiKey) throw new Error('GEMINI_API_KEY가 스크립트 속성에 설정되지 않았습니다.');

  const url = 'https://generativelanguage.googleapis.com/v1/models/gemini-2.0-flash:generateContent?key=' + apiKey;
  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    headers: { 'Content-Type': 'application/json' },
    payload: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: temperature || 0.2,
        maxOutputTokens: maxTokens || 1024,
      },
    }),
    muteHttpExceptions: true,
  });

  const result = JSON.parse(res.getContentText());
  if (result.error) {
    if (result.error.code === 429) {
      throw new Error('[Gemini] 무료 버전 할당량 초과! 잠시 후 다시 시도해 주세요.');
    }
    throw new Error('[Gemini] ' + result.error.message);
  }
  return result.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
}

// ─── Skill 5: 모듈 요약 (Gemini) ─────────────────────────
function getModuleSummary(module) {
  const { requirements: reqs } = getRequirements(module);
  if (!reqs.length) return { summary: null };

  const reqList = reqs.slice(0, 40)
    .map(r => `- ${r.요구사항명}${r.설명 ? ': ' + r.설명 : ''}`)
    .join('\n');

  const mName = module.split('_').slice(1).join('_') || module;
  const prompt = `아래는 서비스 기획의 "${mName}" 모듈 요구사항 목록입니다.\n이 모듈이 어떤 역할을 하는 모듈인지 기획자가 한눈에 파악할 수 있도록 2~3문장으로 설명해주세요. 요구사항 통계나 개수는 언급하지 마세요.\n\n요구사항 목록:\n${reqList}\n\n모듈 설명 (2~3문장):`;

  try {
    const text = callGemini(prompt, 0.3, 256);
    return { summary: text };
  } catch (err) {
    return { summary: null, error: err.message };
  }
}

// ─── Skill 2: req-analyzer (Gemini) ──────────────────────
function analyzeWithGemini(requirements, type) {
  const list = requirements
    .map((r, i) => `[${i + 1}] (${r.우선순위}) ${r.요구사항명}: ${r.설명 || ''}`)
    .join('\n');

  const prompts = {
    duplicate:
      `아래는 서비스 기획 요구사항 목록입니다. 의미적으로 중복되거나 매우 유사한 요구사항 쌍을 모두 찾아주세요.\n\n요구사항 목록:\n${list}\n\n결과를 아래 형식의 JSON 배열로만 반환하세요 (다른 텍스트 없이):\n[{"item_a": 번호, "item_b": 번호, "reason": "중복 이유 (1~2문장)"}]\n없으면 []`,
    conflict:
      `아래는 서비스 기획 요구사항 목록입니다. 논리적으로 상충되거나 모순이 있는 요구사항 쌍을 모두 찾아주세요.\n\n요구사항 목록:\n${list}\n\n결과를 아래 형식의 JSON 배열로만 반환하세요 (다른 텍스트 없이):\n[{"item_a": 번호, "item_b": 번호, "reason": "상충 이유 (1~2문장)"}]\n없으면 []`,
  };

  let text;
  try {
    text = callGemini(prompts[type], 0.1, 2048);
  } catch (err) {
    return { error: err.message };
  }

  if (!text) return { error: 'AI 응답을 받지 못했습니다.' };

  const cleaned = text
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  const pairs = JSON.parse(cleaned);
  return {
    pairs: pairs
      .map(p => ({
        item_a: requirements[p.item_a - 1],
        item_b: requirements[p.item_b - 1],
        reason: p.reason,
      }))
      .filter(p => p.item_a && p.item_b),
  };
}
