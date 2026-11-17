import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,existsSync} from "node:fs";
import {execFileSync} from "node:child_process";

const read=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
const included=read("scripts/build-pages.mjs");
test("transaction modules and styles are included in GitHub Pages output",()=>{
  for(const path of ["transaction-collected.js","transaction-explorer.js","transaction-explorer.css"]){
    assert.ok(existsSync(new URL("../"+path,import.meta.url)),path);
    assert.ok(included.includes(`"${path}"`),path);
  }
});
test("address search startup keeps the transaction visualization lazy",()=>{
  const app=read("app.js");
  const head=app.split("\n").slice(0,20).join("\n");
  assert.ok(!head.includes("transaction-explorer.js"));
  assert.match(app,/import\("\.\/transaction-explorer\.js\?v=/);
  assert.match(read("transaction-api.js"),/await import\("\.\/transaction-collected\.js\?v=/);
});
test("new JavaScript modules are parseable",()=>{
  for(const path of ["app.js","transaction-api.js","transaction-explorer.js","transaction-collected.js"]){
    execFileSync(process.execPath,["--check",new URL("../"+path,import.meta.url).pathname],{stdio:"pipe"});
  }
});
test("site mounts transaction style and versioned application script",()=>{
  const html=read("index.html");
  assert.match(html,/transaction-explorer\.css\?v=/);
  assert.match(html,/src="\.\/app\.js\?v=20261117-3"/);
});
