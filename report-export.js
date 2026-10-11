import {composeParcelMap, composeVworldTileMap} from "./parcel-map.js?v=20261012-3";

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

  function pageHeaderHtml(model, {title = model.title, compact = false} = {}) {
    return `<p class="download-report__brand">토지이용한눈 · Land Use at a Glance</p>
      <h1${compact ? ' class="compact"' : ""}>${escapeHtml(title)}</h1>
      <p class="download-report__address">${escapeHtml(model.address)}</p>
      <div class="download-report__meta">
        <span>도로명 ${escapeHtml(safeValue(model.road))}</span>
        <span>작성일 ${escapeHtml(model.generatedAt)}</span>
        <span>PNU ${escapeHtml(safeValue(model.pnu))}</span>
      </div>`;
  }

  function vicinityPageHtml(model) {
    if (!model.vicinity) return "";
    const location = `${Number(model.vicinity.longitude).toFixed(6)}, ${Number(model.vicinity.latitude).toFixed(6)}`;
    const image = model.vicinity.imageDataUrl
      ? `<img src="${escapeHtml(model.vicinity.imageDataUrl)}" alt="선택한 필지 경계가 강조된 주변 항공 지도">`
      : `<div class="download-report__map-error">필지 부근 이미지를 불러오지 못했습니다.<br>보고서의 주소와 토지이음 원문을 함께 확인해 주세요.</div>`;
    return `<article class="download-report" aria-hidden="true">
      ${pageHeaderHtml(model, {title: "필지 부근 위치", compact: true})}
      <section class="download-report__vicinity">
        <h2>필지 부근 위치</h2>
        <div class="download-report__map">${image}</div>
        <div class="download-report__map-caption">
          <strong><i></i> 선택 필지 경계 강조</strong>
          <span>좌표 ${escapeHtml(location)} · VWorld 항공·도로 혼합 지도</span>
        </div>
        <p>주소 검색 위치를 기준으로 조회한 연속지적도 경계를 강조한 참고 이미지입니다. 실제 경계와 법적 지적도는 관계기관의 공식 자료로 다시 확인하세요.</p>
      </section>
      <footer class="download-report__footer"><span>지도 출처: 공간정보 오픈플랫폼 VWorld</span><span>PNU ${escapeHtml(model.pnu)}</span></footer>
    </article>`;
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

    const vicinityPage = vicinityPageHtml(model);
    if (vicinityPage) pages.push(vicinityPage);

    if (restrictionSection.rows.length) {
      chunks.forEach((rows, index) => {
        const section = {...restrictionSection, rows};
        const isLast = index === chunks.length - 1;
        pages.push(`<article class="download-report" aria-hidden="true">
          ${pageHeaderHtml(model, {title: "주요 행위제한 및 근거 법령", compact: true})}
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

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.addEventListener("load", () => resolve(reader.result), {once: true});
      reader.addEventListener("error", () => reject(new Error("필지 부근 이미지를 읽지 못했습니다.")), {once: true});
      reader.readAsDataURL(blob);
    });
  }

  async function loadVicinityImage(model, onProgress) {
    if (!model.vicinity) return model;
    notify(onProgress, 14, "필지 부근 항공 지도를 불러오고 있어요.");
    try {
      if (model.vicinity.useTileMap) {
        const imageDataUrl = await composeVworldTileMap({
          geometry: model.vicinity.geometry || null,
          longitude: model.vicinity.longitude,
          latitude: model.vicinity.latitude,
          address: model.address
        });
        notify(onProgress, 19, "지도에 선택 필지 경계를 표시하고 있어요.");
        return {...model, vicinity: {...model.vicinity, imageDataUrl, hasBoundary: Boolean(model.vicinity.geometry)}};
      }
      if (!model.vicinity.imageUrl) return model;
      const response = await fetch(model.vicinity.imageUrl, {headers: {Accept: "image/png"}});
      if (!response.ok) throw new Error(`필지 부근 이미지 HTTP ${response.status}`);
      const blob = await response.blob();
      if (blob.type !== "image/png") throw new Error("필지 부근 이미지 형식이 올바르지 않습니다.");
      const imageDataUrl = await blobToDataUrl(blob);
      let geometry = model.vicinity.geometry || null;
      if (!geometry && model.vicinity.geometryUrl) {
        notify(onProgress, 17, "선택한 필지 경계를 확인하고 있어요.");
        try {
          const geometryResponse = await fetch(model.vicinity.geometryUrl, {headers: {Accept: "application/json"}});
          if (geometryResponse.ok) geometry = (await geometryResponse.json())?.feature?.geometry || null;
        } catch (error) {
          console.warn("Parcel geometry unavailable", error);
        }
      }
      notify(onProgress, 19, geometry ? "지도에 선택 필지 경계를 표시하고 있어요." : "필지 위치 지도를 정리하고 있어요.");
      const composedImage = await composeParcelMap({
        imageDataUrl,
        geometry,
        longitude: model.vicinity.longitude,
        latitude: model.vicinity.latitude,
        address: model.address
      });
      return {...model, vicinity: {...model.vicinity, imageDataUrl: composedImage, hasBoundary: Boolean(geometry)}};
    } catch (error) {
      console.warn("Vicinity image unavailable", error);
      return {...model, vicinity: {...model.vicinity, imageError: true}};
    }
  }

  async function waitForImages(reports) {
    const images = reports.flatMap((report) => [...report.querySelectorAll("img")]);
    await Promise.all(images.map(async (image) => {
      if (!image.complete) {
        await new Promise((resolve) => {
          image.addEventListener("load", resolve, {once: true});
          image.addEventListener("error", resolve, {once: true});
        });
      }
      if (typeof image.decode === "function") await image.decode().catch(() => {});
    }));
  }

  async function captureReports(model, onProgress) {
    if (typeof window.html2canvas !== "function") throw new Error("PDF 화면 생성 모듈을 불러오지 못했습니다.");
    const reports = createReportElements(model);
    try {
      notify(onProgress, 20, "조회 내용을 보고서 형식으로 정리하고 있어요.");
      if (document.fonts?.ready) await document.fonts.ready;
      await waitForImages(reports);
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

  async function generatePdf(model, onProgress) {
    if (!window.jspdf?.jsPDF) throw new Error("PDF 파일 생성 모듈을 불러오지 못했습니다.");
    notify(onProgress, 8, "보고서 생성 준비 중입니다.");
    const hydratedModel = await loadVicinityImage(model, onProgress);
    const canvases = await captureReports(hydratedModel, onProgress);
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

    notify(onProgress, 96, "보고서 뷰어를 준비하고 있어요.");
    const result = {blob: pdf.output("blob"), fileName: fileName(model)};
    notify(onProgress, 100, "보고서 미리보기가 준비되었습니다.");
    return result;
  }

  async function exportPdf(model, onProgress) {
    const result = await generatePdf(model, onProgress);
    const url = URL.createObjectURL(result.blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = result.fileName;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    return result;
  }

  window.TojiIyongReport = {generatePdf, exportPdf};
})();
