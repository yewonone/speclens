// =============================================================
// SpecLens — Skill 1: sheets-sync
// Google Apps Script를 통해 스프레드시트 데이터를 읽고 씁니다.
// =============================================================

const SheetsSync = (() => {
  const URL_KEY = 'speclens_script_url';

  function getURL() {
    return localStorage.getItem(URL_KEY) || '';
  }

  function setURL(url) {
    localStorage.setItem(URL_KEY, url.trim());
  }

  function isConfigured() {
    return !!getURL();
  }

  // GET 요청 (쿼리 파라미터 방식)
  async function get(params) {
    const url = new URL(getURL());
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    const res = await fetch(url.toString(), { redirect: 'follow' });
    if (!res.ok) throw new Error(`네트워크 오류: ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return data;
  }

  // POST 요청 (Content-Type: text/plain → CORS preflight 없음)
  async function post(body) {
    const res = await fetch(getURL(), {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(body),
      redirect: 'follow',
    });
    if (!res.ok) throw new Error(`네트워크 오류: ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return data;
  }

  return {
    getURL,
    setURL,
    isConfigured,

    /** 시트에서 모듈 목록을 가져옵니다 */
    getModules: () => get({ action: 'getModules' }),

    /** 특정 모듈의 요구사항 목록을 가져옵니다 (P1→P2→P3 정렬) */
    getRequirements: (module) => get({ action: 'getRequirements', module }),

    /** 특정 모듈의 요구사항을 시트에 저장합니다 */
    saveRequirements: (module, requirements) =>
      post({ action: 'save', module, requirements }),

    /** Gemini로 모듈 요약을 생성합니다 */
    getModuleSummary: (module) => get({ action: 'getModuleSummary', module }),

    /** Gemini로 요구사항 분석 (type: 'duplicate' | 'conflict') */
    analyze: (requirements, type) => post({ action: 'analyze', requirements, type }),

    /** 전체 투표 현황을 가져옵니다 */
    getVotes: () => get({ action: 'getVotes' }),

    /** 투표를 제출합니다 (upDelta/downDelta: +1 or -1) */
    submitVote: (reqId, reqName, upDelta, downDelta) =>
      post({ action: 'vote', reqId, reqName, upDelta, downDelta }),

    /** 모든 요구사항의 코멘트 수를 가져옵니다 */
    getCommentCounts: () => get({ action: 'getCommentCounts' }),

    /** 특정 요구사항의 코멘트 목록을 가져옵니다 */
    getComments: (reqId) => get({ action: 'getComments', reqId }),

    /** 코멘트를 추가합니다 */
    addComment: (reqId, reqName, text) => post({ action: 'addComment', reqId, reqName, text }),

    /** 코멘트를 삭제합니다 */
    deleteComment: (commentId) => post({ action: 'deleteComment', commentId }),
  };
})();
