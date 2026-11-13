import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {readFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = file => readFileSync(path.join(root, file), "utf8");

test("토지이용한눈 상단 계정 아이콘은 로그인 UI를 제공한다", () => {
  const html = read("index.html");
  assert.match(html, /id="accountEntry"/);
  assert.match(html, /account-ui\.css/);
  assert.match(html, /account-ui\.js/);
  assert.match(read("account-ui.js"), /loginAccount\(id\)/);
  assert.match(read("account-ui.js"), /availableProviders\(\)/);
});

test("공통 계정 인증 코드가 PKCE·출처 검증·세션 범위를 지킨다", () => {
  const client = read("account-client.mjs");
  assert.match(client, /"tojiiyonghannun"/);
  assert.match(client, /"SHA-256"/);
  assert.match(client, /event\.source !== popup/);
  assert.match(client, /event\.origin !== new URL\(ACCOUNT_WORKER\)\.origin/);
  assert.match(client, /sessionStorage/);
  assert.doesNotMatch(client, /localStorage/);
});

test("GitHub Pages 빌드에 인증 자산이 포함된다", () => {
  const build = read("scripts/build-pages.mjs");
  for (const name of ["account-client.mjs", "account-ui.js", "account-ui.css"]) {
    assert.match(build, new RegExp('"' + name.replace(".", "\\.") + '"'));
  }
});

test("독립 인증 자산은 Node 문법 검사를 통과한다", () => {
  for (const name of ["account-client.mjs", "account-ui.js"]) {
    execFileSync(process.execPath, ["--check", path.join(root, name)]);
  }
});
