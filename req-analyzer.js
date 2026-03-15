// =============================================================
// SpecLens — Skill 2: req-analyzer (로컬 분석, API 불필요)
// 브라우저에서 직접 실행 — 네트워크 요청 없음
//
// 중복 탐지: 문자 n-gram Jaccard 유사도
// 충돌 탐지: 서비스 기획 도메인 키워드 패턴 매칭
// =============================================================

const ReqAnalyzer = (() => {

  // ─── 텍스트 유틸 ────────────────────────────────────────

  function getText(req) {
    return (req.요구사항명 + ' ' + (req.설명 || '')).replace(/\s+/g, ' ').trim();
  }

  // 문자 n-gram 집합 생성 (공백 제거 후)
  function charNgrams(text, n) {
    const s = text.replace(/\s/g, '');
    const result = new Set();
    for (let i = 0; i <= s.length - n; i++) result.add(s.slice(i, i + n));
    return result;
  }

  // Jaccard 유사도: 교집합 / 합집합
  function jaccard(setA, setB) {
    const inter = [...setA].filter(x => setB.has(x)).length;
    const union = new Set([...setA, ...setB]).size;
    return union ? inter / union : 0;
  }

  // bigram(40%) + trigram(60%) 가중 유사도
  function similarity(t1, t2) {
    const bi  = jaccard(charNgrams(t1, 2), charNgrams(t2, 2));
    const tri = jaccard(charNgrams(t1, 3), charNgrams(t2, 3));
    return bi * 0.4 + tri * 0.6;
  }

  // ─── 중복 탐지 ──────────────────────────────────────────
  // 유사도 >= threshold 인 쌍을 유사도 높은 순으로 반환

  function detectDuplicates(requirements, threshold = 0.28) {
    const pairs = [];
    for (let i = 0; i < requirements.length; i++) {
      for (let j = i + 1; j < requirements.length; j++) {
        const sim = similarity(getText(requirements[i]), getText(requirements[j]));
        if (sim >= threshold) {
          pairs.push({
            item_a: requirements[i],
            item_b: requirements[j],
            reason: `텍스트 유사도 ${Math.round(sim * 100)}% — 두 요구사항의 내용이 서로 겹쳐요.`,
            _sim: sim,
          });
        }
      }
    }
    return { pairs: pairs.sort((a, b) => b._sim - a._sim) };
  }

  // ─── 충돌 탐지 ──────────────────────────────────────────
  // 같은 맥락(적당한 유사도)에서 반대 표현이 쓰인 쌍을 반환

  const CONFLICT_PAIRS = [
    {
      a: ['필수', '반드시', '무조건', '필수적'],
      b: ['선택', '권장', '선택적', '옵션', '임의'],
      label: '필수 ↔ 선택',
    },
    {
      a: ['항상', '모든 경우', '예외 없이', '전 채널', '모든 사용자'],
      b: ['경우에 따라', '조건부', '특정 경우', '일부 사용자', '선택적으로'],
      label: '항상 ↔ 조건부',
    },
    {
      a: ['실시간', '즉시', '즉각', '바로'],
      b: ['지연', '배치', '주기적', '정기적', '일괄'],
      label: '실시간 ↔ 지연 처리',
    },
    {
      a: ['허용', '가능하다', '제공한다', '지원한다'],
      b: ['불가', '금지', '차단', '제한', '허용하지 않'],
      label: '허용 ↔ 제한',
    },
    {
      a: ['노출', '표시', '보여준다', '노출한다'],
      b: ['숨김', '미노출', '숨겨', '비노출', '표시하지 않'],
      label: '노출 ↔ 숨김',
    },
    {
      a: ['자동', '자동으로', '자동 처리'],
      b: ['수동', '직접', '사용자가 직접'],
      label: '자동 ↔ 수동',
    },
    {
      a: ['로그인', '인증 후', '회원만', '로그인한'],
      b: ['비로그인', '비회원', '미인증', '로그인 없이'],
      label: '로그인 필요 ↔ 비로그인 허용',
    },
    {
      a: ['간소화', '단순', '최소화', '줄인다'],
      b: ['상세', '복잡', '최대한', '풍부하게'],
      label: '간소화 ↔ 상세화',
    },
    {
      a: ['통합', '하나로', '단일', '일원화'],
      b: ['분리', '별도', '각각', '구분하여'],
      label: '통합 ↔ 분리',
    },
    {
      a: ['최소', '하한', '이상'],
      b: ['최대', '상한', '이하', '초과 불가'],
      label: '최솟값 ↔ 최댓값 상충',
    },
    {
      a: ['고정', '변경 불가', '고정값'],
      b: ['유동', '변경 가능', '설정 가능', '커스텀'],
      label: '고정 ↔ 가변',
    },
  ];

  function hasKeyword(text, words) {
    return words.some(w => text.includes(w));
  }

  function detectConflicts(requirements) {
    const pairs = [];
    const found = new Set(); // 중복 쌍 방지

    for (let i = 0; i < requirements.length; i++) {
      for (let j = i + 1; j < requirements.length; j++) {
        const t1 = getText(requirements[i]);
        const t2 = getText(requirements[j]);
        const sim = similarity(t1, t2);

        // 너무 무관하거나(< 0.08) 이미 중복인(>= 0.28) 쌍은 제외
        if (sim < 0.08 || sim >= 0.28) continue;

        for (const cp of CONFLICT_PAIRS) {
          const a1 = hasKeyword(t1, cp.a), b1 = hasKeyword(t1, cp.b);
          const a2 = hasKeyword(t2, cp.a), b2 = hasKeyword(t2, cp.b);

          if ((a1 && b2) || (b1 && a2)) {
            const key = `${i}-${j}`;
            if (!found.has(key)) {
              found.add(key);
              pairs.push({
                item_a: requirements[i],
                item_b: requirements[j],
                reason: `[${cp.label}] 비슷한 맥락에서 서로 상반된 표현이 사용됐어요. 두 요구사항이 충돌할 수 있어요.`,
              });
            }
            break;
          }
        }
      }
    }
    return { pairs };
  }

  return { detectDuplicates, detectConflicts };
})();
