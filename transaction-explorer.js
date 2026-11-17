// 실거래 분석 UI. 주소 검색/지도 초기화와 독립적으로, 조회 성공 후에만 로드된다.
const nf = new Intl.NumberFormat("ko-KR", {maximumFractionDigits:1});
const integer = new Intl.NumberFormat("ko-KR", {maximumFractionDigits:0});
const ECHARTS_URL="https://cdn.jsdelivr.net/npm/echarts@6.1.0/dist/echarts.min.js";
const SQUARE_METERS_PER_PYEONG=3.305785;
let echartsPromise;
const trendCharts=new WeakMap();
function loadECharts() {
  if(globalThis.echarts)return Promise.resolve(globalThis.echarts);
  if(echartsPromise)return echartsPromise;
  echartsPromise=new Promise((resolve,reject)=>{
    const script=document.createElement("script");
    script.src=ECHARTS_URL;script.async=true;script.crossOrigin="anonymous";
    script.onload=()=>globalThis.echarts?resolve(globalThis.echarts):reject(new Error("ECharts 객체를 찾지 못했습니다."));
    script.onerror=()=>reject(new Error("ECharts를 불러오지 못했습니다."));
    document.head.append(script);
  });
  return echartsPromise;
}
function money(v) {
  const n=Number(v)||0;
  if (!n) return "—";
  const e=Math.floor(n/10000), rem=Math.round(n%10000);
  return e ? `${e}억${rem ? " "+integer.format(rem)+"만원":""}` : `${integer.format(n)}만원`;
}
export function unitPricePerPyeong(unitPrice) {
  const value=Number(unitPrice)||0;
  return value>0?value*SQUARE_METERS_PER_PYEONG:0;
}
function pyeongPrice(unitPrice) {
  const value=unitPricePerPyeong(unitPrice);
  return value?`${integer.format(value/10000)}만원/평`:"계산 불가";
}
export function buildTransactionParcelQuery(parcelAddress,row) {
  if(!row?.legalDong||!row?.normalizedJibun)return "";
  const tokens=String(parcelAddress||"").trim().split(/\s+/).filter(Boolean);
  let dongIndex=-1;
  for(let index=tokens.length-1;index>=0;index-=1){if(/(?:동|읍|면|리|가)$/.test(tokens[index])){dongIndex=index;break;}}
  const prefix=dongIndex>=0?tokens.slice(0,dongIndex):tokens.slice(0,Math.max(0,tokens.length-2));
  return [...prefix,row.legalDong,row.jibun].filter(Boolean).join(" ");
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
function appendStat(root,label,value,note="") {
  const item=el("div","txi-stat");
  item.append(el("small","",label),el("strong","",value));
  if(note)item.append(el("span","txi-stat-note",note));
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
async function drawTrend(root,items) {
  const {points,months}=buildTransactionTrend(items);
  const previous=trendCharts.get(root);
  if(previous){previous.observer.disconnect();previous.chart.dispose();trendCharts.delete(root);}
  root.replaceChildren();
  if(!points.length){root.append(el("p","txi-empty","가격을 계산할 거래가 없습니다."));return;}
  const scroller=el("div","txi-chart");scroller.setAttribute("role","img");scroller.setAttribute("aria-label",`계약일별 제곱미터당 단가 ${points.length}건과 월별 거래 건수 복합차트`);
  const legend=el("div","txi-legend");legend.append(el("span","txi-legend-price","거래별 ㎡당 단가"),el("span","txi-legend-volume","월 거래 건수"));
  root.append(legend,scroller,el("p","txi-note","가격은 월평균이 아닌 개별 계약일 기준입니다. 선은 거래 순서를 연결하며, 하단 막대만 월별 거래 건수를 나타냅니다."));
  try {
    const echarts=await loadECharts();
    if(!scroller.isConnected)return;
    const chart=echarts.init(scroller,null,{renderer:"canvas"});
    const priceData=points.map(point=>({value:[point.time,point.unitPrice],amount:point.amount,date:point.contractDate}));
    const volumeData=months.map(month=>[new Date(`${month.month}-15T00:00:00`).getTime(),month.count]);
    chart.setOption({
      animationDuration:350,
      color:["#176b4a","#a8cdb9"],
      aria:{enabled:true,description:`계약일별 제곱미터당 단가 ${points.length}건과 월별 거래 건수입니다.`},
      grid:{left:64,right:54,top:26,bottom:82},
      tooltip:{trigger:"axis",axisPointer:{type:"cross"},backgroundColor:"rgba(24,49,39,.94)",borderWidth:0,textStyle:{color:"#fff"},formatter(params){
        const rows=Array.isArray(params)?params:[];
        const price=rows.find(row=>row.seriesName==="거래별 ㎡당 단가");
        const volume=rows.find(row=>row.seriesName==="월 거래 건수");
        const date=price?.data?.date||new Date(rows[0]?.value?.[0]).toISOString().slice(0,10);
        return [`<strong>${date.replace(/-/g,".")}</strong>`,price?`${pyeongPrice(price.value[1])} · ㎡당 ${integer.format(price.value[1])}원 · ${money(price.data.amount)}`:"",volume?`해당 월 ${volume.value[1]}건`:""].filter(Boolean).join("<br>");
      }},
      xAxis:{type:"time",boundaryGap:false,axisLabel:{color:"#64786d",formatter:value=>new Intl.DateTimeFormat("ko-KR",{year:"2-digit",month:"2-digit"}).format(value)},axisLine:{lineStyle:{color:"#cbd9d1"}},splitLine:{show:false}},
      yAxis:[
        {type:"value",scale:true,name:"㎡당 가격",nameTextStyle:{color:"#526b5e"},axisLabel:{color:"#64786d",formatter:value=>`${nf.format(value/10000)}만`},splitLine:{lineStyle:{color:"#e4ece7"}}},
        {type:"value",min:0,name:"월 거래",nameTextStyle:{color:"#708078"},axisLabel:{color:"#708078",formatter:value=>`${value}건`},splitLine:{show:false}}
      ],
      dataZoom:[{type:"inside",xAxisIndex:0,filterMode:"none"},{type:"slider",xAxisIndex:0,filterMode:"none",height:22,bottom:22,borderColor:"#d6e3dc",fillerColor:"rgba(23,107,74,.16)",handleStyle:{color:"#176b4a"}}],
      series:[
        {name:"월 거래 건수",type:"bar",yAxisIndex:1,data:volumeData,barWidth:14,itemStyle:{color:"rgba(138,190,163,.62)",borderRadius:[3,3,0,0]},z:1},
        {name:"거래별 ㎡당 단가",type:"line",yAxisIndex:0,data:priceData,showSymbol:true,symbolSize:7,smooth:.16,lineStyle:{width:3,color:"#176b4a"},itemStyle:{color:"#fff",borderColor:"#176b4a",borderWidth:2},emphasis:{focus:"series",scale:1.5},z:3}
      ]
    });
    const observer=new ResizeObserver(()=>chart.resize());observer.observe(scroller);trendCharts.set(root,{chart,observer});
  } catch(error) {
    scroller.replaceChildren(el("p","txi-empty","차트를 불러오지 못했습니다. 거래 목록에서 가격을 확인해 주세요."));
    console.warn("ECharts 로딩 실패",error);
  }
}
function drawList(root,items,areaKind,scope,parcelAddress,onOpenParcel) {
  root.replaceChildren();
  if(!items.length){root.append(el("p","txi-empty","해당 면적대에 공개 거래가 없습니다."));return;}
  const sorted=[...items].sort((a,b)=>String(b.contractDate).localeCompare(String(a.contractDate)));
  for(const row of sorted.slice(0,20)){
    const query=scope==="nearby"?buildTransactionParcelQuery(parcelAddress,row):"";
    const article=el(query?"button":"article",`txi-trade${query?" txi-trade-link":""}`);
    if(query){article.type="button";article.setAttribute("aria-label",`${row.legalDong} ${row.jibun} 필지 조회`);article.addEventListener("click",()=>onOpenParcel?.(query));}
    const price=el("strong","",money(row.amount));
    const head=el("div","txi-trade-head");
    head.append(price,el("time","",String(row.contractDate||"").replace(/-/g,".")));
    const main=[row.area>0?`${areaKind} ${nf.format(row.area)}㎡`:"면적 미제공",row.floor?`${row.floor}층`:""].filter(Boolean).join(" · ");
    const subtitle=row.buildingName||[row.legalDong,row.jibun].filter(Boolean).join(" ");
    article.append(head,el("div","txi-trade-size",main),
      el("p","txi-trade-meta",[pyeongPrice(row.unitPrice),`㎡당 ${row.unitPrice?integer.format(row.unitPrice)+"원":"계산 불가"}`,scope==="exact"?"":subtitle].filter(Boolean).join(" · ")));
    if(query)article.append(el("span","txi-trade-open","이 필지 조회 ›"));
    root.append(article);
  }
}
export function showTransactionExplorer(result, landUse = {}, {onOpenParcel} = {}) {
  const parent=document.querySelector("#transactionResults");
  if(!parent)return;
  const existing=document.querySelector("#transactionExplorer");
  if(existing)existing.remove();
  parent.classList.remove("txi-enhanced");
  const clean=items=>(items||[]).filter(x=>!x.cancelled&&x.amount>0);
  const exactItems=clean(result.exactItems ?? (result.scope==="exact"?result.items:[]));
  const nearbyItems=clean(result.nearbyItems ?? (result.scope==="nearby"?result.items:[]));
  const groupable=["apartment","officetel","rowHouse"].includes(result.type);
  const section=el("section","txi",undefined);section.id="transactionExplorer";
  const header=el("div","txi-heading");
  const scopeSwitch=el("div","txi-scope-switch");scopeSwitch.setAttribute("aria-label","거래 비교 범위");
  const ranges=[
    {key:"exact",label:"해당 필지·단지",items:exactItems},
    {key:"nearby",label:"같은 법정동 비교",items:nearbyItems}
  ].filter(range=>range.items.length||range.key==="exact");
  for(const range of ranges){const button=el("button","txi-scope-button",`${range.label} · ${integer.format(range.items.length)}건`);button.type="button";button.dataset.scope=range.key;button.disabled=!range.items.length;scopeSwitch.append(button);range.button=button;}
  header.append(el("div","txi-heading-copy","거래 가격 분석"),scopeSwitch);
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
  const intro=el("p","txi-intro","면적이 다른 거래는 직접 비교하기 어렵습니다. 비교할 전용면적을 선택하세요.");
  section.append(intro,filters);
  const metrics=el("div","txi-metrics");
  const conclusion=el("p","txi-conclusion");
  const chartTitle=el("h4","txi-section-heading","거래기간 ㎡당 가격 흐름");
  const chart=el("div","txi-trend");
  const recentTitle=el("h4","txi-section-heading","최근 거래");
  const list=el("div","txi-trades");
  const note=el("p","txi-caution");
  section.append(metrics,conclusion,chartTitle,chart,recentTitle,list,note);
  parent.querySelector("#transactionStats")?.before(section);
  if(!section.isConnected)parent.prepend(section);
  let entries=[],activeScope=result.scope==="exact"&&exactItems.length?"exact":"nearby";
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
    appendStat(metrics,"평당 중간가격",rate?pyeongPrice(rate):"—",rate?`㎡당 ${integer.format(rate)}원`:"");
    conclusion.textContent=insights(selection,{...result,scope:activeScope});
    void drawTrend(chart,selection);
    drawList(list,selection,result.definition?.areaKind||"면적",activeScope,landUse.address,onOpenParcel);
    note.textContent=activeScope==="exact"
      ?"공개 지번이 일치하는 거래입니다. 동일 단지 내에서도 동·층·향·상태에 따라 가격이 달라질 수 있습니다."
      :"선택 필지 거래를 제외한 같은 법정동의 비교 거래입니다. 선택 필지의 시세로 단정할 수 없습니다.";
  }
  function selectScope(scope) {
    const range=ranges.find(item=>item.key===scope&&item.items.length) || ranges.find(item=>item.items.length);
    if(!range)return;
    activeScope=range.key;
    for(const item of ranges){const active=item===range;item.button.classList.toggle("active",active);item.button.setAttribute("aria-pressed",String(active));}
    filters.replaceChildren();
    const allButton=el("button","txi-filter active","전체");allButton.type="button";allButton.setAttribute("aria-pressed","true");filters.append(allButton);
    entries=[{button:allButton,items:range.items,anchor:null}];
    const options=groupable?cohorts(range.items):[];
    if(options.length>1){for(const group of options.slice(0,8)){const button=el("button","txi-filter",`${nf.format(group.anchor)}㎡ · ${group.items.length}건`);button.type="button";button.setAttribute("aria-pressed","false");filters.append(button);entries.push({button,items:group.items,anchor:group.anchor});}}
    intro.hidden=entries.length<=1;filters.hidden=entries.length<=1;
    entries.forEach((entry,index)=>entry.button.addEventListener("click",()=>select(index)));
    const defaultIndex=entries.length>1?entries.map((entry,index)=>({index,count:entry.items.length})).slice(1).sort((a,b)=>b.count-a.count)[0].index:0;
    select(defaultIndex);
  }
  ranges.forEach(range=>range.button.addEventListener("click",()=>selectScope(range.key)));
  selectScope(activeScope);
  parent.classList.add("txi-enhanced");
}
