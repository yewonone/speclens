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
  };
})();
