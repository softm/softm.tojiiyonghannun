// 실거래가는 신고된 거래의 요약이며 시세·감정평가액을 의미하지 않습니다.
function median(values) {
  const sorted = values.filter(v => Number.isFinite(v) && v > 0).sort((a,b) => a-b);
  if (!sorted.length) return 0;
  const i = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[i] : (sorted[i-1] + sorted[i]) / 2;
}
const monthValue = d => String(d || "").slice(0,7).replace("-", "");
export function buildTransactionInsights(result, now = new Date()) {
  const items = (result.items || []).filter(x => !x.cancelled && x.unitPrice > 0 && x.area > 0);
  if (!items.length) return {messages: ["비교할 거래가 부족합니다. 거래내역과 조회 기간을 먼저 확인하세요."], areaGroups: [], caution: "표본 부족: 가격 변화나 시세 수준을 판단할 수 없습니다."};
  const residential = ["apartment", "officetel", "rowHouse"].includes(result.type);
  // 동일 면적대(±5%)끼리 먼저 묶어 서로 다른 주택 크기의 가격 비교를 방지한다.
  const areaGroups = [];
  for (const item of [...items].sort((a,b)=>a.area-b.area)) {
    let group = areaGroups.find(g => Math.abs(g.anchor-item.area)/g.anchor <= .05);
    if (!group) { group = {anchor:item.area, items:[]}; areaGroups.push(group); }
    group.items.push(item);
  }
  areaGroups.sort((a,b)=>b.items.length-a.items.length);
  const selected = residential ? areaGroups[0].items : items;
  const messages = [];
  if (residential && areaGroups.length > 1) messages.push("서로 다른 면적대가 포함되어 있습니다. 가격 비교는 거래가 가장 많은 비슷한 면적끼리 계산했습니다.");
  const sortedByDate = [...selected].sort((a,b)=>String(b.contractDate).localeCompare(String(a.contractDate)));
  const last = sortedByDate[0];
  if (last) messages.push(`최근 비교 거래: ${last.contractDate || "날짜 미상"} · ${last.area.toFixed(1)}㎡ · ${last.amount.toLocaleString("ko-KR")}만원`);
  const thisMonth = now.getFullYear()*12 + now.getMonth();
  const withAge = selected.map(item => {
    const m = monthValue(item.contractDate);
    const match = m.match(/^(\d{4})(\d{2})$/);
    const age = match ? thisMonth - (Number(match[1])*12 + Number(match[2])-1) : 999;
    return {...item, age};
  });
  const recent = withAge.filter(x=>x.age>=0 && x.age<6);
  const previous = withAge.filter(x=>x.age>=6 && x.age<12);
  if (!result.failedMonths && recent.length >= 3 && previous.length >= 3) {
    const a=median(recent.map(x=>x.unitPrice));
    const b=median(previous.map(x=>x.unitPrice));
    const pct=(a/b-1)*100;
    messages.push(`최근 6개월 ㎡당 중간가격은 직전 6개월 대비 ${pct>=0?"+":""}${pct.toFixed(1)}% (${recent.length}건 vs ${previous.length}건, 유사 면적 기준)`);
  } else {
    messages.push("비교 표본이 부족하거나 일부 조회 월이 누락되어 가격 변동률을 계산하지 않았습니다.");
  }
  return {
    messages,
    areaGroups: areaGroups.filter(g=>g.items.length>=2).slice(0,5).sort((a,b)=>a.anchor-b.anchor).map(g=>({
      area: g.anchor,
      count: g.items.length,
      medianAmount:median(g.items.map(x=>x.amount)),
      medianUnitPrice:median(g.items.map(x=>x.unitPrice))
    })),
    caution: result.scope === "exact"
      ? "같은 필지·단지의 공개 거래 참고값입니다. 층·향·동·상태에 따라 실제 가치는 다를 수 있습니다."
      : "동일 법정동의 비교 거래입니다. 선택 필지의 실거래 또는 감정가로 해석하지 마세요."
  };
}
