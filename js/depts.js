/* Department registry — brain region ids, colors, and keyword fallback classifier.
   Region ids must match the zone assignment in brain3d.js / brain2d.js (1-7). */
(() => {
  'use strict';

  window.DEPTS = {
    strategy:     { id: 1, name: '전략기획팀', color: '#b26bff',
      keywords: ['전략', '기획', '사업계획', '로드맵', '방향', '목표', '비전', '신사업', '확장', '투자', '분기 계획'] },
    marketing:    { id: 2, name: '마케팅팀', color: '#ff6ec7',
      keywords: ['마케팅', '광고', '홍보', '캠페인', '인스타', 'sns', '유튜브', '콘텐츠', '브랜딩', '퍼포먼스', '노출', '릴스', '블로그'] },
    sales:        { id: 3, name: '영업팀', color: '#58ff9b',
      keywords: ['영업', '고객', '상담', '문의', '견적', '미팅', '수주', '클라이언트', '계약 따', '제안서', '리드'] },
    design:       { id: 4, name: '설계팀', color: '#4da6ff',
      keywords: ['설계', '도면', '디자인', '평면도', '구조', '인테리어', '스케치', '캐드', 'cad', '3d 모델', '도색', '자재 선정'] },
    construction: { id: 5, name: '시공팀', color: '#ffb347',
      keywords: ['시공', '공사', '현장', '착공', '준공', '자재', '철거', '마감', '공정', '인력', '감리', '하자보수 공사'] },
    finance:      { id: 6, name: '정산팀', color: '#ffd700',
      keywords: ['정산', '세금', '매출', '비용', '대금', '입금', '지출', '부가세', '계산서', '급여', '월급', '세무', '경비'] },
    legal:        { id: 7, name: '법무팀', color: '#ff5c5c',
      keywords: ['법무', '계약서', '계약 검토', '소송', '분쟁', '법적', '하자', '보증', '약관', '특약', '내용증명', '손해배상'] },
  };

  /* keyword fallback classifier — returns a dept key or null */
  window.classifyDept = function (text) {
    if (!text) return null;
    const t = text.toLowerCase();
    let best = null, bestScore = 0;
    for (const [key, d] of Object.entries(window.DEPTS)) {
      let score = 0;
      for (const kw of d.keywords) if (t.includes(kw)) score++;
      if (score > bestScore) { bestScore = score; best = key; }
    }
    return best;
  };
})();
