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

function formatNumber(value, suffix = "") {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? `${new Intl.NumberFormat("ko-KR", {maximumFractionDigits: 2}).format(number)}${suffix}` : "-";
}

function formatBuildingDate(value) {
  const digits = clean(value).replace(/\D/g, "");
  return digits.length === 8 ? `${digits.slice(0, 4)}.${digits.slice(4, 6)}.${digits.slice(6, 8)}` : valueOrDash(value);
}

function formatContractDate(value) {
  return valueOrDash(value).replaceAll("-", ".");
}

function formatDealAmount(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return "-";
  const billion = Math.floor(amount / 10000);
  const remainder = Math.round(amount % 10000);
  return [billion ? `${billion}억` : "", remainder ? `${new Intl.NumberFormat("ko-KR").format(remainder)}만원` : ""].filter(Boolean).join(" ") || "-";
}

function formatUnitPrice(value) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? `${new Intl.NumberFormat("ko-KR").format(Math.round(amount))}원/㎡` : "-";
}

function buildingName(building, index) {
  return clean([building?.name, building?.dongName && building.dongName !== building.name ? building.dongName : ""].filter(Boolean).join(" · ")) || `건축물 ${index + 1}`;
}

function buildSupplementSections(data, item, context, address, pnu) {
  const buildings = Array.isArray(context?.buildings) ? context.buildings : [];
  const transaction = context?.transaction || null;
  const landRegister = context?.landRegister || null;
  const scope = transaction?.scope === "exact" ? "해당 필지·단지 거래" : "법정동 유사 거래";
  const transactionLabel = clean(transaction?.definition?.label || transaction?.type) || "선택 유형";
  const transactionNotes = transaction
    ? [
      `정상 거래 ${Number(transaction.totalCount || 0)}건`,
      transaction.cancelledCount ? `취소 ${transaction.cancelledCount}건 제외` : "",
      transaction.failedMonths ? `${transaction.failedMonths}개월 조회 실패` : "",
      transaction.truncated ? "일부 월 최대 5페이지 표시" : ""
    ].filter(Boolean).join(" · ")
    : "보고서 생성 시 조회 결과가 없거나 공공데이터 조회를 완료하지 못했습니다.";
  const officialUrl = clean(data?.officialUrl) || `https://www.eum.go.kr/web/ar/lu/luLandDet.jsp?chk=0&isNoScr=script&mode=search&pnu=${encodeURIComponent(pnu)}&selGbn=umd`;
  const integratedUrl = `https://tojiiyonghannun.designboard.net/building-ledger.html?pnu=${encodeURIComponent(pnu)}&tab=building`;
  const landRegisterIssueUrl = "https://www.gov.kr/mw/AA020InfoCappView.do?CappBizCD=13100000026";
  const cadastralMapIssueUrl = "https://www.gov.kr/mw/AA020InfoCappView.do?CappBizCD=13100000027";
  const registryIssueUrl = "https://www.iros.go.kr/";

  return [
    {
      title: "토지대장·지적공부 공개정보",
      pageTitle: "토지 공부·권리 확인",
      pageSize: 14,
      kind: "keyValue",
      rows: landRegister ? [
        ["대장 구분", valueOrDash(landRegister.ledgerType)],
        ["소재지", valueOrDash([landRegister.legalDong, landRegister.lotNumber].filter(Boolean).join(" "))],
        ["지목", valueOrDash(landRegister.landCategory)],
        ["면적", formatNumber(landRegister.area, "㎡")],
        ["소유구분", valueOrDash(landRegister.ownershipType)],
        ["공유인수", landRegister.coOwnerCount == null ? "미제공" : `${landRegister.coOwnerCount}명`],
        ["지적도 정보", valueOrDash([landRegister.cadastralMapType, landRegister.cadastralScale ? `축척 ${landRegister.cadastralScale}` : ""].filter(Boolean).join(" · "))],
        ["공개정보 기준일", valueOrDash(landRegister.lastUpdated)]
      ] : [["조회 상태", "토지대장 공개정보를 불러오지 못했습니다. 아래 공식 발급 경로에서 확인하세요."]],
      notice: "소유구분·공유인수는 공개 범위의 참고정보입니다. 소유자별 성명·주소·지분과 현재 권리관계는 공식 발급 문서 및 등기기록으로 확인하세요."
    },
    {
      title: `건축물대장 요약 (${buildings.length}개)`,
      pageTitle: "건축물대장 요약",
      pageSize: 14,
      headers: ["건축물", "주용도", "층수", "건축/연면적", "사용승인"],
      rows: buildings.map((building, index) => [
        buildingName(building, index),
        valueOrDash(building?.use),
        [building?.groundFloors ? `지상 ${building.groundFloors}층` : "", building?.undergroundFloors ? `지하 ${building.undergroundFloors}층` : ""].filter(Boolean).join(" · ") || "-",
        `${formatNumber(building?.buildingArea, "㎡")} / ${formatNumber(building?.totalArea, "㎡")}`,
        formatBuildingDate(building?.approvalDate)
      ]),
      notice: buildings.length ? "필지에서 확인된 건축물 목록의 주요 항목입니다. 세부 대장 원문은 대장·토지이음 통합 보기에서 확인하세요." : "이 필지에서 확인된 건축물이 없거나 건축물 공개정보를 불러오지 못했습니다."
    },
    {
      title: `${transactionLabel} 최근 24개월 실거래 요약`,
      pageTitle: "실거래 참고",
      pageSize: 16,
      kind: "keyValue",
      rows: [
        ["조회 범위", transaction ? scope : "조회 결과 없음"],
        ["조회 유형", transactionLabel],
        ["거래 건수", transaction ? `${Number(transaction.totalCount || 0)}건` : "-"],
        ["최근 거래일", transaction?.latestDate ? formatContractDate(transaction.latestDate) : "-"],
        ["거래금액 중앙값", formatDealAmount(transaction?.medianAmount)],
        ["㎡당 중앙값", formatUnitPrice(transaction?.medianUnitPrice)],
        ["㎡당 거래 범위", transaction?.minUnitPrice ? `${formatUnitPrice(transaction.minUnitPrice)} ~ ${formatUnitPrice(transaction.maxUnitPrice)}` : "-"],
        ["조회 상태", transactionNotes]
      ],
      notice: "실거래가는 일반시세·감정가·미래가치가 아니며, 일부 유형은 개인정보 보호를 위해 지번이 일부만 공개됩니다."
    },
    {
      title: "월별 ㎡당 중간가격",
      pageTitle: "실거래 월별 추이",
      pageSize: 24,
      skipWhenEmpty: true,
      headers: ["계약월", "㎡당 중간가격", "거래 건수"],
      rows: (transaction?.trend || []).map((entry) => [
        clean(entry.month).replace(/^(\d{4})(\d{2})$/, "$1.$2"),
        formatUnitPrice(entry.medianUnitPrice),
        `${Number(entry.count || 0)}건`
      ])
    },
    {
      title: "최근 거래 목록",
      pageTitle: "실거래 최근 거래",
      pageSize: 12,
      skipWhenEmpty: true,
      headers: ["계약일", "건물·지번", "거래금액", "면적·층", "㎡당 가격"],
      rows: (transaction?.items || []).slice(0, 12).map((entry) => [
        formatContractDate(entry.contractDate),
        valueOrDash(entry.buildingName || [entry.legalDong, entry.jibun].filter(Boolean).join(" ")),
        formatDealAmount(entry.amount),
        [entry.area ? `${formatNumber(entry.area, "㎡")}` : "", entry.floor ? `${entry.floor}층` : "", entry.landCategory || entry.mainUse || ""].filter(Boolean).join(" · ") || "-",
        formatUnitPrice(entry.unitPrice)
      ])
    },
    {
      title: "공식 원문·연계 확인 경로",
      pageTitle: "공식 확인 경로",
      pageSize: 12,
      kind: "keyValue",
      rows: [
        ["토지이음 원문", officialUrl],
        ["대장·토지이음 통합 보기", integratedUrl],
        ["토지(임야)대장 발급", landRegisterIssueUrl],
        ["지적도(임야도) 등본 발급", cadastralMapIssueUrl],
        ["공유지연명부 확인", landRegisterIssueUrl],
        ["등기사항전부증명서", registryIssueUrl],
        ["국토교통부 실거래가 공개시스템", "https://rt.molit.go.kr/"],
        ["대한민국 법원경매정보", "https://www.courtauction.go.kr/"],
        ["경매 검색 주소", address]
      ],
      notice: "경매 사건은 자동 매칭하지 않습니다. 주소를 복사해 대한민국 법원경매정보에서 직접 확인하세요."
    }
  ];
}

export function buildReportModel(data, item, generatedAt = new Date(), context = {}) {
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
      imageUrl: `/api/vicinity-map?pnu=${encodeURIComponent(pnu)}&x=${encodeURIComponent(longitude)}&y=${encodeURIComponent(latitude)}`,
      geometryUrl: `/api/parcel-geometry?pnu=${encodeURIComponent(pnu)}&x=${encodeURIComponent(longitude)}&y=${encodeURIComponent(latitude)}`
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
    supplementSections: buildSupplementSections(data, item, context, address, pnu),
    source: "출처: 토지이음 · 공간정보 오픈플랫폼 VWorld · 국토교통부 실거래가 공개시스템 · 대한민국 법원경매정보",
    notice: "이 보고서는 공개된 정보를 이해하기 쉽게 정리한 참고자료이며 공식 토지이용계획확인서가 아닙니다. 인허가, 거래 등 법적 판단이 필요한 경우 토지이음 원문과 관계기관을 통해 다시 확인하세요."
  };
}
