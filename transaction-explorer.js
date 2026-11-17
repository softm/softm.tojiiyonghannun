// 실거래 분석 UI. 주소 검색/지도 초기화와 독립적으로, 조회 성공 후에만 로드된다.
const nf = new Intl.NumberFormat("ko-KR", {maximumFractionDigits:1});
const integer = new Intl.NumberFormat("ko-KR", {maximumFractionDigits:0});
function money(v) {
  const n=Number(v)||0;
  if (!n) return "—";
  const e=Math.floor(n/10000), rem=Math.round(n%10000);
  return e ? `${e}억${rem ? " "+integer.format(rem)+"만원":""}` : `${integer.format(n)}만원`;
}
function median(values) {
  const data=values.filter(n=>Number.isFinite(n)&&n>0).sort((a,b)=>a-b);
  if (!data.length) return null;
  const m=Math.floor(data.length/2);
  return data.length%2 ? data[m] : (data[m-1]+data[m])/2;
}
const el=(tag,className,text)=>{
  const node=document.createElement(tag);
  if(className) node.className=className;
  if(text!==undefined) node.textContent=text;
  return node;
};
function cohorts(items) {
  const groups=[];
  for (const entry of [...items].filter(x=>x.area>0).sort((a,b)=>a.area-b.area)) {
    let group=groups.find(g=>Math.abs(g.anchor-entry.area)/g.anchor<=.05);
    if(!group){group={anchor:entry.area,items:[]};groups.push(group);}
    group.items.push(entry);
  }
  return groups.sort((a,b)=>a.anchor-b.anchor);
}
function insights(items, result, now=new Date()) {
  const withPrice=items.filter(x=>x.unitPrice>0);
  const recent=withPrice.filter(x=>{
    const d=new Date(x.contractDate+"T00:00:00");
    if(!Number.isFinite(d.getTime()))return false;
    const age=(now.getFullYear()-d.getFullYear())*12+now.getMonth()-d.getMonth();
    return age>=0&&age<6;
  });
  const prior=withPrice.filter(x=>{
    const d=new Date(x.contractDate+"T00:00:00");
    if(!Number.isFinite(d.getTime()))return false;
    const age=(now.getFullYear()-d.getFullYear())*12+now.getMonth()-d.getMonth();
    return age>=6&&age<12;
  });
  // 동일 면적에 대한 비교가 가능해야만 '상승/하락'으로 해석한다.
  if(result.failedMonths || result.truncated || recent.length<3 || prior.length<3) return "비교 가능한 거래가 부족하거나 일부 기간이 누락되어 가격 변화율을 표시하지 않습니다.";
  const a=median(recent.map(x=>x.unitPrice)), b=median(prior.map(x=>x.unitPrice));
  if(!a||!b)return "가격 변화율을 계산할 수 없습니다.";
  const pct=(a/b-1)*100;
  return `최근 6개월 ㎡당 중간가격은 직전 6개월 대비 ${pct>0?"+":""}${pct.toFixed(1)}% · ${recent.length}건 / ${prior.length}건 기준`;
}
function appendStat(root,label,value) {
  const item=el("div","txi-stat");
  item.append(el("small","",label),el("strong","",value));
  root.append(item);
}
function drawTrend(root,items) {
  const byMonth=new Map();
  for(const item of items){
    if(!item.unitPrice||!/^\d{6}$/.test(item.yearMonth||""))continue;
    if(!byMonth.has(item.yearMonth))byMonth.set(item.yearMonth,[]);
    byMonth.get(item.yearMonth).push(item.unitPrice);
  }
  const rows=[...byMonth].sort((a,b)=>a[0].localeCompare(b[0])).map(([month,v])=>({month,price:median(v),count:v.length})).slice(-24);
  root.replaceChildren();
  if(!rows.length){root.append(el("p","txi-empty","가격을 계산할 거래가 없습니다."));return;}
  const max=Math.max(...rows.map(x=>x.price));
  const chart=el("div","txi-chart");
  chart.setAttribute("role","img");
  chart.setAttribute("aria-label","월별 제곱미터당 중간가격과 거래 건수");
  for(const x of rows) {
    const cell=el("div","txi-bar");
    cell.title=`${x.month.slice(0,4)}.${x.month.slice(4)} · ㎡당 ${integer.format(x.price)}원 · ${x.count}건`;
    const shape=el("i","");shape.style.height=`${Math.max(5,x.price/max*100)}%`;
    cell.append(shape,el("small","",`${x.month.slice(2,4)}.${x.month.slice(4)}`));chart.append(cell);
  }
  root.append(chart,el("p","txi-note","거래가 있는 월만 표시 · 월별 ㎡당 중간가격 · 빈 달은 0원이 아닙니다."));
}
function drawList(root,items,areaKind,scope) {
  root.replaceChildren();
  if(!items.length){root.append(el("p","txi-empty","해당 면적대에 공개 거래가 없습니다."));return;}
  const sorted=[...items].sort((a,b)=>String(b.contractDate).localeCompare(String(a.contractDate)));
  for(const row of sorted.slice(0,20)){
    const article=el("article","txi-trade");
    const price=el("strong","",money(row.amount));
    const head=el("div","txi-trade-head");
    head.append(price,el("time","",String(row.contractDate||"").replace(/-/g,".")));
    const main=[row.area>0?`${areaKind} ${nf.format(row.area)}㎡`:"면적 미제공",row.floor?`${row.floor}층`:""].filter(Boolean).join(" · ");
    const subtitle=row.buildingName||[row.legalDong,row.jibun].filter(Boolean).join(" ");
    article.append(head,el("div","txi-trade-size",main),
      el("p","txi-trade-meta",[`㎡당 ${row.unitPrice?integer.format(row.unitPrice)+"원":"계산 불가"}`,scope==="exact"?"":subtitle].filter(Boolean).join(" · ")));
    root.append(article);
  }
}
export function showTransactionExplorer(result, landUse = {}) {
  const parent=document.querySelector("#transactionResults");
  if(!parent)return;
  const existing=document.querySelector("#transactionExplorer");
  if(existing)existing.remove();
  parent.classList.remove("txi-enhanced");
  const items=(result.items||[]).filter(x=>!x.cancelled&&x.amount>0);
  const groupable=["apartment","officetel","rowHouse"].includes(result.type);
  const options=groupable?cohorts(items):[];
  const section=el("section","txi",undefined);section.id="transactionExplorer";
  const header=el("div","txi-heading");
  header.append(el("div","txi-heading-copy","거래 가격 분석"),el("span","txi-scope",result.scope==="exact"?"해당 필지·단지 공개 거래":"법정동 비교 거래"));
  section.append(header);
  const planning=(landUse.nationalPlan || []).map(zone=>String(zone.name||"").trim()).filter(Boolean);
  if (planning.length) {
    const zoning=el("div","txi-zoning");
    zoning.append(el("strong","","이 필지의 토지이용계획"),el("span","",planning.slice(0,4).join(" · ")));
    zoning.append(el("small","","위 지정정보는 선택 필지 기준입니다. 아래 주변 거래에도 동일 규제가 적용된다는 뜻은 아닙니다."));
    section.append(zoning);
  }
  const filters=el("div","txi-filters");
  filters.setAttribute("aria-label","거래 면적 선택");
  const allButton=el("button","txi-filter active","전체");allButton.type="button";allButton.setAttribute("aria-pressed","true");filters.append(allButton);
  const entries=[{button:allButton,items,anchor:null}];
  if(options.length>1){
    for(const group of options.slice(0,8)) {
      const button=el("button","txi-filter",`${nf.format(group.anchor)}㎡ · ${group.items.length}건`);
      button.type="button";button.setAttribute("aria-pressed","false");
      filters.append(button);entries.push({button,items:group.items,anchor:group.anchor});
    }
  }
  if(entries.length>1)section.append(el("p","txi-intro","면적이 다른 거래는 직접 비교하기 어렵습니다. 비교할 전용면적을 선택하세요."),filters);
  const metrics=el("div","txi-metrics");
  const conclusion=el("p","txi-conclusion");
  const chartTitle=el("h4","txi-section-heading","월별 ㎡당 거래단가");
  const chart=el("div","txi-trend");
  const recentTitle=el("h4","txi-section-heading","최근 거래");
  const list=el("div","txi-trades");
  const note=el("p","txi-caution",result.scope==="exact"
    ?"공개 지번이 일치하는 거래입니다. 동일 단지 내에서도 동·층·향·상태에 따라 가격이 달라질 수 있습니다."
    :"법정동 범위의 비교 거래입니다. 선택 필지의 거래 또는 시세로 단정할 수 없습니다.");
  section.append(metrics,conclusion,chartTitle,chart,recentTitle,list,note);
  parent.querySelector("#transactionStats")?.before(section);
  if(!section.isConnected)parent.prepend(section);
  function select(index) {
    for(const [i,x] of entries.entries()){
      x.button.classList.toggle("active",i===index);
      x.button.setAttribute("aria-pressed",String(i===index));
    }
    const selection=entries[index].items;
    const ordered=[...selection].sort((a,b)=>String(b.contractDate).localeCompare(String(a.contractDate)));
    metrics.replaceChildren();
    appendStat(metrics,"비교 거래 수",`${selection.length}건`);
    appendStat(metrics,"가장 최근 거래",ordered.length?money(ordered[0].amount):"—");
    appendStat(metrics,"거래금액 중간값",money(median(selection.map(x=>x.amount))));
    const rate=median(selection.map(x=>x.unitPrice));
    appendStat(metrics,"㎡당 중간가격",rate?`${integer.format(rate)}원`:"—");
    conclusion.textContent=insights(selection,result);
    drawTrend(chart,selection);
    drawList(list,selection,result.definition?.areaKind||"면적",result.scope);
  }
  entries.forEach((x,i)=>x.button.addEventListener("click",()=>select(i)));
  // 동일 단지에 여러 면적대가 있으면 표본이 가장 많은 그룹을 첫 비교 기준으로 선택.
  const defaultIndex=entries.length>1
    ? entries.map((entry,index)=>({index,count:entry.items.length})).slice(1).sort((a,b)=>b.count-a.count)[0].index
    : 0;
  select(defaultIndex);
  parent.classList.add("txi-enhanced");
}
