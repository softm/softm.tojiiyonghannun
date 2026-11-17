import test from "node:test";
import assert from "node:assert/strict";
import {buildTransactionInsights} from "../transaction-insights.js";

function item(month, day, area=84, amount=60000) {
  return {type:"apartment",cancelled:false,contractDate:`2026-${month}-${day}`,
    yearMonth:`2026${month}`,area,amount,unitPrice:amount*10000/area};
}
test("insights do not infer a trend from one transaction",()=>{
  const result=buildTransactionInsights({type:"apartment",scope:"exact",items:[item("11","01")],failedMonths:0},new Date(2026,10,17));
  assert.match(result.messages.join(" "),/표본|부족/);
});
test("insights compare same-sized homes and separate area cohorts",()=>{
  const values=[item("11","01",84,70000),item("10","05",84,70000),item("09","01",84,70000),
    item("05","01",84,60000),item("04","01",84,60000),item("03","01",84,60000),
    item("08","01",59,43000),item("07","01",59,44000)];
  const result=buildTransactionInsights({type:"apartment",scope:"exact",items:values,failedMonths:0},new Date(2026,10,17));
  assert.match(result.messages.join(" "),/16\.7%/);
  assert.equal(result.areaGroups.length,2);
});
test("incomplete months suppress price trend claims",()=>{
  const values=[item("11","01"),item("10","01"),item("09","01"),item("05","01"),item("04","01"),item("03","01")];
  const result=buildTransactionInsights({type:"apartment",scope:"nearby",items:values,failedMonths:2},new Date(2026,10,17));
  assert.doesNotMatch(result.messages.join(" "),/대비 [+-]/);
});
