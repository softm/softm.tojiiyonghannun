(function () {
  "use strict";

  const REPORT_WIDTH = 794;

  function escapeHtml(value) {
    return String(value ?? "-")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function safeValue(value) {
    return String(value ?? "").trim() || "-";
  }

  function fileName(model) {
    const base = safeValue(model.fileBase || model.address || "토지이용계획")
      .replace(/[\\/:*?"<>|]/g, "_")
      .replace(/\s+/g, "_")
      .slice(0, 80);
    return `${base}_토지이용계획_보고서.pdf`;
  }

  function sectionHtml(section) {
    if (!section.rows?.length) return '<p class="download-report__empty">조회된 정보가 없습니다.</p>';
    if (section.kind === "keyValue") {
      return `<table class="key-value"><tbody>${section.rows.map(([label, value]) => `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(safeValue(value))}</td></tr>`).join("")}</tbody></table>`;
    }
    const headers = section.headers || ["내용"];
    return `<table class="data-table"><thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead><tbody>${section.rows.map((row) => `<tr>${row.map((value) => `<td>${escapeHtml(safeValue(value))}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  }

  function pageHeaderHtml(model, compact = false) {
    return `<p class="download-report__brand">토지이용한눈 · Land Use at a Glance</p>
      <h1${compact ? ' class="compact"' : ""}>${escapeHtml(compact ? "주요 행위제한 및 근거 법령" : model.title)}</h1>
      <p class="download-report__address">${escapeHtml(model.address)}</p>
      <div class="download-report__meta">
        <span>도로명 ${escapeHtml(safeValue(model.road))}</span>
        <span>작성일 ${escapeHtml(model.generatedAt)}</span>
        <span>PNU ${escapeHtml(safeValue(model.pnu))}</span>
      </div>`;
  }

  function reportPagesHtml(model) {
    const overviewSections = model.sections.slice(0, 3);
    const restrictionSection = model.sections[3] || {title: "주요 행위제한 및 근거 법령", headers: [], rows: []};
    const chunks = [];
    for (let index = 0; index < restrictionSection.rows.length; index += 18) {
      chunks.push(restrictionSection.rows.slice(index, index + 18));
    }
    if (!chunks.length) chunks.push([]);

    const pages = [
      `<article class="download-report" aria-hidden="true">
        ${pageHeaderHtml(model)}
        ${overviewSections.map((section) => `<section><h2>${escapeHtml(section.title)}</h2>${sectionHtml(section)}</section>`).join("")}
        ${restrictionSection.rows.length ? "" : `<p class="download-report__notice">${escapeHtml(model.notice)}</p><footer class="download-report__footer"><span>${escapeHtml(model.source)}</span><span>토지이용한눈 자동 생성 보고서</span></footer>`}
      </article>`
    ];

    if (restrictionSection.rows.length) {
      chunks.forEach((rows, index) => {
        const section = {...restrictionSection, rows};
        const isLast = index === chunks.length - 1;
        pages.push(`<article class="download-report" aria-hidden="true">
          ${pageHeaderHtml(model, true)}
          <section class="download-report__continuation"><h2>${escapeHtml(restrictionSection.title)} ${chunks.length > 1 ? `(${index + 1}/${chunks.length})` : ""}</h2>${sectionHtml(section)}</section>
          ${isLast ? `<p class="download-report__notice">${escapeHtml(model.notice)}</p><footer class="download-report__footer"><span>${escapeHtml(model.source)}</span><span>토지이용한눈 자동 생성 보고서</span></footer>` : ""}
        </article>`);
      });
    }
    return pages;
  }

  function createReportElements(model) {
    return reportPagesHtml(model).map((html) => {
      const holder = document.createElement("div");
      holder.innerHTML = html;
      const report = holder.firstElementChild;
      document.body.appendChild(report);
      return report;
    });
  }

  function notify(callback, percent, message) {
    callback?.({percent, message});
  }

  async function captureReports(model, onProgress) {
    if (typeof window.html2canvas !== "function") throw new Error("PDF 화면 생성 모듈을 불러오지 못했습니다.");
    const reports = createReportElements(model);
    try {
      notify(onProgress, 20, "조회 내용을 보고서 형식으로 정리하고 있어요.");
      if (document.fonts?.ready) await document.fonts.ready;
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const canvases = [];
      for (let index = 0; index < reports.length; index += 1) {
        notify(onProgress, 30 + Math.round(((index + 1) / reports.length) * 30), `${index + 1}/${reports.length} 페이지 화면을 변환하고 있어요.`);
        canvases.push(await window.html2canvas(reports[index], {
          backgroundColor: "#ffffff",
          scale: 2,
          useCORS: true,
          logging: false,
          width: REPORT_WIDTH,
          windowWidth: REPORT_WIDTH
        }));
      }
      return canvases;
    } finally {
      reports.forEach((report) => report.remove());
    }
  }

  async function exportPdf(model, onProgress) {
    if (!window.jspdf?.jsPDF) throw new Error("PDF 파일 생성 모듈을 불러오지 못했습니다.");
    notify(onProgress, 8, "보고서 생성 준비 중입니다.");
    const canvases = await captureReports(model, onProgress);
    notify(onProgress, 68, "A4 페이지로 정리하고 있어요.");

    const {jsPDF} = window.jspdf;
    const pdf = new jsPDF({orientation: "portrait", unit: "mm", format: "a4", compress: true});
    const pageWidth = 210;
    const pageHeight = 297;
    const margin = 10;
    const contentWidth = pageWidth - margin * 2;
    const contentHeight = pageHeight - margin * 2;

    for (let pageIndex = 0; pageIndex < canvases.length; pageIndex += 1) {
      if (pageIndex > 0) pdf.addPage();
      const canvas = canvases[pageIndex];
      const scale = Math.min(contentWidth / canvas.width, contentHeight / canvas.height);
      const imageWidth = canvas.width * scale;
      const imageHeight = canvas.height * scale;
      pdf.addImage(canvas.toDataURL("image/jpeg", .94), "JPEG", margin + (contentWidth - imageWidth) / 2, margin, imageWidth, imageHeight, undefined, "FAST");
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(8);
      pdf.setTextColor(110, 124, 117);
      pdf.text(`${pageIndex + 1} / ${canvases.length}`, pageWidth - margin, pageHeight - 4, {align: "right"});
      notify(onProgress, 70 + Math.round(((pageIndex + 1) / canvases.length) * 22), `${pageIndex + 1}/${canvases.length} 페이지를 만들고 있어요.`);
    }

    notify(onProgress, 96, "PDF 파일을 저장하고 있어요.");
    pdf.save(fileName(model));
    notify(onProgress, 100, "보고서 다운로드를 완료했습니다.");
  }

  window.TojiIyongReport = {exportPdf};
})();
