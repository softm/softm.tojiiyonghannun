function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function valueOrDash(value) {
  return clean(value) || "-";
}

function formatGeneratedAt(date) {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

function formatPrice(amount, year) {
  if (!Number(amount)) return "미제공";
  const price = `${new Intl.NumberFormat("ko-KR").format(Number(amount))}원/㎡`;
  return year ? `${price} (${year}년 기준)` : price;
}

export function buildReportModel(data, item, generatedAt = new Date()) {
  const address = clean(data?.address || item?.parcelAddress || item?.primaryAddress || "선택한 필지");
  const pnu = clean(item?.pnu || data?.pnu);
  const longitude = Number(item?.longitude);
  const latitude = Number(item?.latitude);
  const hasVicinity = Number.isFinite(longitude) && Number.isFinite(latitude);
  const nationalPlan = data?.nationalPlan || [];
  const otherLaws = [...(data?.otherLaws || []), ...(data?.decree || [])];
  const restrictions = (data?.restrictions || []).flatMap((group) => (group.rules || []).map((rule) => [
    valueOrDash(group.zone),
    valueOrDash(rule.law),
    valueOrDash([rule.article, rule.subject].filter(Boolean).join(" · "))
  ]));
  return {
    title: "토지이용계획 열람 요약 보고서",
    address,
    road: clean(item?.roadAddress),
    pnu,
    generatedAt: formatGeneratedAt(generatedAt),
    fileBase: address,
    vicinity: hasVicinity ? {
      longitude,
      latitude,
      imageUrl: `/api/vicinity-map?pnu=${encodeURIComponent(pnu)}&x=${encodeURIComponent(longitude)}&y=${encodeURIComponent(latitude)}`
    } : null,
    sections: [
      {
        title: "필지 기본정보",
        kind: "keyValue",
        rows: [
          ["소재지", address],
          ["도로명주소", valueOrDash(item?.roadAddress)],
          ["필지고유번호(PNU)", valueOrDash(pnu)],
          ["지목", valueOrDash(data?.landCategory)],
          ["면적", valueOrDash(data?.area)],
          ["개별공시지가", formatPrice(data?.price, data?.priceYear)]
        ]
      },
      {
        title: "국토계획법에 따른 지역·지구",
        headers: ["지역·지구", "설명"],
        rows: nationalPlan.map((zone) => [valueOrDash(zone.name), valueOrDash(zone.description)])
      },
      {
        title: "다른 법령에 따른 지정",
        headers: ["지역·지구", "설명"],
        rows: otherLaws.map((zone) => [valueOrDash(zone.name), valueOrDash(zone.description)])
      },
      {
        title: "주요 행위제한 및 근거 법령",
        headers: ["대상 지역·지구", "근거 법령", "조문·대상"],
        rows: restrictions
      }
    ],
    source: "출처: 토지이음 · 공간정보 오픈플랫폼 VWorld",
    notice: "이 보고서는 공개된 정보를 이해하기 쉽게 정리한 참고자료이며 공식 토지이용계획확인서가 아닙니다. 인허가, 거래 등 법적 판단이 필요한 경우 토지이음 원문과 관계기관을 통해 다시 확인하세요."
  };
}
