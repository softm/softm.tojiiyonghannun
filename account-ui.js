import {
  ACCOUNT_WORKER, availableProviders, currentAccount, loginAccount, logoutAccount
} from "./account-client.mjs";

const trigger = document.getElementById("accountEntry");
const siteName = "토지이용한눈";
const providerNames = {google: "Google", kakao: "카카오", naver: "네이버"};
let providerStatus = null;
let busy = false;
let loading = false;
let feedback = "";

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function validPhoto(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && !parsed.username && !parsed.password && url.length <= 2048;
  } catch { return false; }
}

function avatar(user, className) {
  const node = element("span", className, (user?.displayName || "한").slice(0, 1));
  if (validPhoto(user?.photoURL)) {
    const photo = document.createElement("img");
    photo.alt = "";
    photo.referrerPolicy = "no-referrer";
    photo.src = user.photoURL;
    photo.addEventListener("error", () => {
      photo.remove();
      node.textContent = (user.displayName || "한").slice(0, 1);
    }, {once: true});
    node.replaceChildren(photo);
  }
  return node;
}

function guestIcon() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.8");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("aria-hidden", "true");
  const head = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  head.setAttribute("cx", "12");
  head.setAttribute("cy", "8");
  head.setAttribute("r", "3.5");
  const body = document.createElementNS("http://www.w3.org/2000/svg", "path");
  body.setAttribute("d", "M4.5 21v-2a7.5 7.5 0 0 1 15 0v2");
  svg.append(head, body);
  return svg;
}

function updateTrigger() {
  const user = currentAccount();
  if (!trigger) return;
  trigger.replaceChildren(user ? avatar(user, "account-trigger__avatar") : guestIcon());
  trigger.setAttribute("aria-label", user ? user.displayName + " 계정 메뉴" : "로그인 및 회원가입");
  trigger.setAttribute("aria-haspopup", "dialog");
  trigger.title = user ? user.displayName + " · 계정 메뉴" : "로그인 및 회원가입";
  trigger.classList.toggle("account-trigger--signed-in", Boolean(user));
  trigger.setAttribute("aria-busy", busy ? "true" : "false");
}

if (trigger) {
  const dialog = element("dialog", "account-dialog");
  dialog.setAttribute("aria-label", "한눈 계정 로그인 및 회원가입");
  const panel = element("div", "account-dialog__panel");
  dialog.append(panel);
  document.body.append(dialog);

  function action(label, onClick, classes = "") {
    const button = element("button", "account-dialog__button " + classes, label);
    button.type = "button";
    button.disabled = busy;
    button.addEventListener("click", onClick);
    return button;
  }

  function render() {
    panel.replaceChildren();
    const header = element("header", "account-dialog__head");
    const heading = element("div");
    heading.append(element("small", "", "SOFTM HANNUN ACCOUNT"));
    heading.append(element("h2", "", currentAccount() ? "내 계정" : "로그인 · 회원가입"));
    const close = action("×", () => dialog.close(), "account-dialog__close");
    close.setAttribute("aria-label", "계정 메뉴 닫기");
    close.disabled = false;
    header.append(heading, close);
    panel.append(header);

    const user = currentAccount();
    if (user) {
      const profile = element("div", "account-dialog__profile");
      profile.append(avatar(user, "account-dialog__profile-avatar"));
      const info = element("div", "account-dialog__profile-info");
      info.append(element("strong", "", user.displayName));
      const linked = user.providers.map(name => providerNames[name]).filter(Boolean);
      info.append(element("span", "", linked.length ? "연결된 계정 · " + linked.join(", ") : "로그인됨"));
      profile.append(info);
      panel.append(profile);
      panel.append(element("p", "account-dialog__description", "토지이용한눈에서 로그인한 상태입니다. 기존 조회 기록은 이 기기에 그대로 남습니다."));
      const manage = element("a", "account-dialog__manage", "계정 설정 및 SNS 연결");
      manage.href = ACCOUNT_WORKER + "/account";
      manage.target = "_blank";
      manage.rel = "noopener noreferrer";
      panel.append(manage);
      const logout = action(busy ? "로그아웃 중…" : "로그아웃", async () => {
        if (busy) return;
        busy = true;
        render(); updateTrigger();
        const revoked = await logoutAccount();
        busy = false;
        feedback = revoked ? "이 서비스에서 로그아웃했습니다." :
          "이 기기의 로그인을 종료했습니다. 서버 연결은 확인되지 않았습니다.";
        updateTrigger();
        render();
        if (!providerStatus) void refreshProviders();
      }, "account-dialog__logout");
      panel.append(logout);
    } else {
      panel.append(element("p", "account-dialog__description",
        "기존 한눈 계정으로 로그인하거나 SNS를 처음 이용해 회원가입할 수 있습니다."));
      const buttons = element("div", "account-dialog__providers");
      for (const id of ["google", "kakao", "naver"]) {
        const enabled = providerStatus?.[id] === true;
        const name = providerNames[id];
        const label = enabled ? name + "로 계속하기" :
          name + (loading ? " · 확인 중" : id === "naver" ? " · 승인 대기 또는 미설정" : " · 연결 준비 중");
        const button = action(label, () => {
          if (busy || !enabled) return;
          // loginAccount가 클릭 이벤트에서 동기적으로 팝업을 연다.
          busy = true;
          feedback = "";
          const operation = loginAccount(id);
          render(); updateTrigger();
          void operation.then(() => {
            dialog.close();
          }).catch(error => {
            feedback = error?.message || "로그인에 실패했습니다.";
          }).finally(() => {
            busy = false;
            updateTrigger();
            render();
          });
        }, "account-dialog__provider account-dialog__provider--" + id);
        button.disabled = busy || !enabled;
        const brand = element("span", "account-dialog__provider-icon", id === "google" ? "G" : id === "naver" ? "N" : "");
        brand.setAttribute("aria-hidden", "true");
        button.prepend(brand);
        buttons.append(button);
      }
      panel.append(buttons);
      panel.append(element("p", "account-dialog__help",
        "첫 로그인에서는 공통 계정 화면에서 이용약관에 동의하면 회원가입이 완료됩니다."));
      if (loading) panel.append(element("p", "account-dialog__loading", "SNS 로그인 상태를 확인하고 있습니다."));
      if (!loading && providerStatus && !Object.values(providerStatus).some(Boolean)) {
        panel.append(element("p", "account-dialog__loading", "사용 가능한 SNS 로그인이 없습니다."));
      }
    }

    if (feedback) {
      const notice = element("p", "account-dialog__notice", feedback);
      notice.setAttribute("role", "status");
      panel.append(notice);
    }
    const foot = element("div", "account-dialog__foot", siteName + " · Cloudflare 공통 계정");
    panel.append(foot);
  }

  async function refreshProviders() {
    if (loading) return;
    loading = true;
    render();
    try {
      providerStatus = await availableProviders();
    } catch {
      providerStatus = {google: false, kakao: false, naver: false};
      feedback = "로그인 서버에 연결할 수 없습니다. 네트워크를 확인하고 다시 열어 주세요.";
    } finally {
      loading = false;
      if (dialog.open) render();
    }
  }

  trigger.addEventListener("click", () => {
    feedback = "";
    updateTrigger();
    render();
    dialog.showModal();
    if (!currentAccount()) void refreshProviders();
  });
  dialog.addEventListener("click", event => {
    if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener("close", () => trigger.focus());
  updateTrigger();
  setInterval(() => updateTrigger(), 60000);
}
