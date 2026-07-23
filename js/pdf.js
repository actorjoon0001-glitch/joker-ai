/* PDF generator — turns a [[PDF:제목|내용]] action from Joker into a real
   downloadable .pdf. jsPDF and the 2MB Korean font are lazy-loaded only when
   the first download is requested, so normal page loads stay light.
   Exposes window.JokerPdf.download(title, content). */
(() => {
  'use strict';

  let loading = null;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('load failed: ' + src));
      document.head.appendChild(s);
    });
  }

  function ensureLibs() {
    if (window.jspdf && window.__jokerPdfFont) return Promise.resolve();
    if (!loading) {
      loading = Promise.all([
        window.jspdf ? null : loadScript('vendor/jspdf.umd.min.js'),
        window.__jokerPdfFont ? null : loadScript('vendor/nanum-font.js'),
      ]);
    }
    return loading;
  }

  async function download(title, content) {
    await ensureLibs();
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    doc.addFileToVFS('NanumGothic.ttf', window.__jokerPdfFont);
    doc.addFont('NanumGothic.ttf', 'NanumGothic', 'normal');
    doc.setFont('NanumGothic');

    const W = doc.internal.pageSize.getWidth();
    const H = doc.internal.pageSize.getHeight();
    const margin = 56;
    const maxW = W - margin * 2;
    let y = margin;

    const newPageIfNeeded = (lineH) => {
      if (y + lineH > H - margin) {
        doc.addPage();
        y = margin;
      }
    };

    /* title */
    doc.setFontSize(19);
    for (const line of doc.splitTextToSize(title, maxW)) {
      newPageIfNeeded(26);
      doc.text(line, margin, y);
      y += 26;
    }

    /* rule + meta */
    y += 2;
    doc.setDrawColor(52, 224, 255);
    doc.setLineWidth(1.2);
    doc.line(margin, y, W - margin, y);
    y += 16;
    doc.setFontSize(9);
    doc.setTextColor(130, 140, 155);
    const dateStr = new Intl.DateTimeFormat('ko-KR', {
      timeZone: 'Asia/Seoul', dateStyle: 'long', timeStyle: 'short',
    }).format(new Date());
    doc.text('JOKER AI 비서 · ' + dateStr, margin, y);
    y += 24;

    /* body */
    doc.setFontSize(11);
    doc.setTextColor(20, 24, 32);
    const lineH = 18;
    for (const para of String(content).split('\n')) {
      if (!para.trim()) { y += lineH * 0.6; continue; }
      for (const line of doc.splitTextToSize(para, maxW)) {
        newPageIfNeeded(lineH);
        doc.text(line, margin, y);
        y += lineH;
      }
      y += 4;
    }

    const safe = String(title).replace(/[\\/:*?"<>|]/g, ' ').trim().slice(0, 60) || '조커 문서';
    doc.save(safe + '.pdf');
  }

  window.JokerPdf = { download };
})();
