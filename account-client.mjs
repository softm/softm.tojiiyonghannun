// 토지이용한눈 전용 Cloudflare 공통 계정 연결 (웹 전용).
// 비밀키 없이 PKCE + 팝업의 정확한 Origin/requestId를 검증한다.
export const ACCOUNT_WORKER = "https://softm-hannun-account.softm.workers.dev";
export const ACCOUNT_SITE = "tojiiyonghannun";
const STORAGE_KEY = "softm-cloudflare:" + ACCOUNT_SITE + ":" + new URL(ACCOUNT_WORKER).hostname;
const PROOF = /^[A-Za-z0-9_-]{43}$/;
const PROVIDERS = new Set(["google", "kakao", "naver"]);

function session() {
  try {
    const data = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "null");
    if (data && PROOF.test(data.token) && typeof data.uid === "string" &&
        Number.isFinite(data.expiresAt) && data.expiresAt > Date.now()) {
      return data;
    }
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    try { sessionStorage.removeItem(STORAGE_KEY); } catch {}
  }
  return null;
}

export function currentAccount() {
  const data = session();
  return data ? {
    uid: data.uid,
    displayName: data.displayName || "한눈 계정",
    photoURL: data.photoURL || "",
    providers: Array.isArray(data.providers) ? data.providers : []
  } : null;
}

function secret() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function sha256(input) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input)));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export async function availableProviders() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);
  try {
    const res = await fetch(ACCOUNT_WORKER + "/health", {cache: "no-store", signal: controller.signal});
    if (!res.ok) throw Error("계정 서버가 응답하지 않습니다.");
    const data = await res.json();
    if (data.ok !== true || !data.providers) throw Error("계정 서버의 상태를 확인하지 못했습니다.");
    return {
      google: data.providers.google === true,
      kakao: data.providers.kakao === true,
      naver: data.providers.naver === true
    };
  } finally {
    clearTimeout(timer);
  }
}

// 반드시 사용자 클릭 핸들러에서 직접 호출: 첫 await 전에 팝업을 열어 차단을 피한다.
export async function loginAccount(provider) {
  if (!PROVIDERS.has(provider)) throw Error("지원하지 않는 로그인 방식입니다.");
  const popup = window.open("about:blank", "_blank", "popup,width=480,height=780");
  if (!popup) throw Error("로그인 창이 차단됐습니다. 팝업을 허용해 주세요.");

  try {
    const verifier = secret();
    const challenge = await sha256(verifier);
    const request = secret();
    const url = new URL("/connect", ACCOUNT_WORKER);
    url.searchParams.set("site", ACCOUNT_SITE);
    url.searchParams.set("origin", location.origin);
    url.searchParams.set("challenge", challenge);
    url.searchParams.set("request", request);
    url.searchParams.set("provider", provider);

    return await new Promise((resolve, reject) => {
      let settled = false;
      let exchanging = false;
      let timer;
      let watch;
      const cleanup = () => {
        window.removeEventListener("message", onMessage);
        clearTimeout(timer);
        clearInterval(watch);
      };
      const finish = (error, result) => {
        if (settled) return;
        settled = true;
        cleanup();
        try { popup.close(); } catch {}
        if (error) reject(error);
        else resolve(result);
      };
      const onMessage = (event) => {
        if (exchanging || settled || event.source !== popup ||
            event.origin !== new URL(ACCOUNT_WORKER).origin ||
            event.data?.type !== "softm:authorization" ||
            event.data?.requestId !== request) return;
        exchanging = true;
        const code = event.data.code;
        if (!PROOF.test(code || "")) return finish(Error("잘못된 인증 응답입니다."));
        void (async () => {
          try {
            const response = await fetch(ACCOUNT_WORKER + "/api/connect/exchange", {
              method: "POST",
              headers: {"Content-Type": "application/json"},
              body: JSON.stringify({site: ACCOUNT_SITE, origin: location.origin, code, verifier}),
              cache: "no-store"
            });
            const data = await response.json();
            if (!response.ok) throw Error(data.message || "로그인을 완료하지 못했습니다.");
            if (!PROOF.test(data.accessToken || "") || typeof data.uid !== "string" ||
                !Number.isFinite(data.expiresIn) || data.expiresIn <= 0 || data.expiresIn > 3600) {
              throw Error("인증 서버 응답이 올바르지 않습니다.");
            }
            const auth = {
              token: data.accessToken,
              uid: data.uid,
              expiresAt: Date.now() + data.expiresIn * 1000,
              displayName: typeof data.displayName === "string" ? data.displayName.slice(0, 100) : "",
              photoURL: typeof data.photoURL === "string" ? data.photoURL.slice(0, 2048) : "",
              providers: Array.isArray(data.providers) ? data.providers.filter(value => PROVIDERS.has(value)) : []
            };
            sessionStorage.setItem(STORAGE_KEY, JSON.stringify(auth));
            finish(null, currentAccount());
          } catch (error) { finish(error); }
        })();
      };
      window.addEventListener("message", onMessage);
      timer = setTimeout(() => finish(Error("로그인 시간이 만료됐습니다. 다시 시도해 주세요.")), 300000);
      watch = setInterval(() => {
        if (!exchanging && popup.closed) finish(Error("로그인 창이 닫혔습니다."));
      }, 700);
      popup.location.assign(url.href);
    });
  } catch (error) {
    try { popup.close(); } catch {}
    throw error;
  }
}

export async function logoutAccount() {
  const data = session();
  let revoked = true;
  try {
    if (data) {
      const res = await fetch(ACCOUNT_WORKER + "/api/apps/" + ACCOUNT_SITE + "/logout", {
        method: "POST", headers: {Authorization: "Bearer " + data.token},
        body: "{}", cache: "no-store"
      });
      revoked = res.ok;
    }
  } catch { revoked = false; }
  finally {
    try { sessionStorage.removeItem(STORAGE_KEY); } catch {}
  }
  return revoked;
}
