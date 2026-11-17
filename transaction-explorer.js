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
export function buildTransactionTrend(items) {
  const points=items.filter(x=>x.unitPrice>0&&/^\d{4}-\d{2}-\d{2}$/.test(x.contractDate||""))
    .map((x,index)=>({...x,time:new Date(`${x.contractDate}T00:00:00`).getTime(),sourceIndex:index}))
    .filter(x=>Number.isFinite(x.time)).sort((a,b)=>a.time-b.time||a.unitPrice-b.unitPrice||a.sourceIndex-b.sourceIndex);
  const months=new Map();
  for(const point of points) {
    const month=point.contractDate.slice(0,7);
    months.set(month,(months.get(month)||0)+1);
  }
  return {points,months:[...months].map(([month,count])=>({month,count}))};
}
function svgNode(tag,attributes={}) {
  const node=document.createElementNS("http://www.w3.org/2000/svg",tag);
  for(const [name,value] of Object.entries(attributes))node.setAttribute(name,String(value));
  return node;
}
function drawTrend(root,items) {
  const {points,months}=buildTransactionTrend(items);
  root.replaceChildren();
  if(!points.length){root.append(el("p","txi-empty","가격을 계산할 거래가 없습니다."));return;}
  const width=Math.max(720,points.length*24),height=280;
  const pad={left:62,right:24,top:22,bottom:54},plotBottom=210,volumeTop=220,volumeBottom=246;
  const times=points.map(x=>x.time),prices=points.map(x=>x.unitPrice);
  const minTime=Math.min(...times),maxTime=Math.max(...times),timeSpan=Math.max(86400000,maxTime-minTime);
  const rawMin=Math.min(...prices),rawMax=Math.max(...prices),priceSpan=Math.max(rawMax*.08,rawMax-rawMin,1);
  const minPrice=Math.max(0,rawMin-priceSpan*.16),maxPrice=rawMax+priceSpan*.16;
  const x=time=>pad.left+(time-minTime)/timeSpan*(width-pad.left-pad.right);
  const y=price=>pad.top+(maxPrice-price)/(maxPrice-minPrice)*(plotBottom-pad.top);
  const svg=svgNode("svg",{viewBox:`0 0 ${width} ${height}`,role:"img","aria-label":`거래 시점별 제곱미터당 단가 ${points.length}건과 월별 거래량`});
  for(let index=0;index<4;index+=1){
    const ratio=index/3,gridY=pad.top+ratio*(plotBottom-pad.top),value=maxPrice-ratio*(maxPrice-minPrice);
    svg.append(svgNode("line",{class:"txi-grid",x1:pad.left,x2:width-pad.right,y1:gridY,y2:gridY}));
    const label=svgNode("text",{class:"txi-axis",x:pad.left-8,y:gridY+4,"text-anchor":"end"});label.textContent=`${nf.format(value/10000)}만`;svg.append(label);
  }
  const line=svgNode("path",{class:"txi-price-line",d:points.map((point,index)=>`${index?"L":"M"}${x(point.time).toFixed(1)},${y(point.unitPrice).toFixed(1)}`).join(" ")});
  svg.append(line);
  for(const point of points){
    const dot=svgNode("circle",{class:"txi-price-dot",cx:x(point.time).toFixed(1),cy:y(point.unitPrice).toFixed(1),r:4,tabindex:0});
    const title=svgNode("title");title.textContent=`${point.contractDate.replace(/-/g,".")} · ㎡당 ${integer.format(point.unitPrice)}원 · ${money(point.amount)}`;dot.append(title);svg.append(dot);
  }
  const maxCount=Math.max(...months.map(x=>x.count));
  for(const month of months){
    const start=new Date(`${month.month}-01T00:00:00`).getTime();
    const end=new Date(new Date(start).getFullYear(),new Date(start).getMonth()+1,0).getTime();
    const center=x(Math.min(maxTime,Math.max(minTime,(start+end)/2)));
    const bar=svgNode("rect",{class:"txi-volume-bar",x:center-7,y:volumeBottom-(month.count/maxCount)*(volumeBottom-volumeTop),width:14,height:(month.count/maxCount)*(volumeBottom-volumeTop)});
    const title=svgNode("title");title.textContent=`${month.month.replace("-",".")} · ${month.count}건`;bar.append(title);svg.append(bar);
  }
  const labelIndexes=[0,Math.floor((points.length-1)/2),points.length-1].filter((value,index,array)=>array.indexOf(value)===index);
  for(const index of labelIndexes){
    const point=points[index],label=svgNode("text",{class:"txi-axis",x:x(point.time),y:272,"text-anchor":index===0?"start":index===points.length-1?"end":"middle"});
    label.textContent=point.contractDate.slice(2,7).replace("-",".");svg.append(label);
  }
  const scroller=el("div","txi-chart");scroller.append(svg);
  const legend=el("div","txi-legend");legend.append(el("span","txi-legend-price","거래별 ㎡당 단가"),el("span","txi-legend-volume","월 거래 건수"));
  root.append(legend,scroller,el("p","txi-note","가격은 월평균이 아닌 개별 계약일 기준입니다. 선은 거래 순서를 연결하며, 하단 막대만 월별 거래 건수를 나타냅니다."));
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
  const chartTitle=el("h4","txi-section-heading","거래기간 ㎡당 가격 흐름");
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
