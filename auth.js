// Shared sign-in (email code, no password) + a small fetch wrapper
// used by pricing.html and chat.html - both need to know who's
// signed in and call the hosted API with their token.

const API_BASE = "https://jarvis-api-94bm.onrender.com";

const TOKEN_KEY = "jarvis_token";

function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}
function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}
function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}
function isSignedIn() {
  return !!getToken();
}

async function authFetch(path, options = {}) {
  const token = getToken();
  const headers = Object.assign(
    { "Content-Type": "application/json" },
    options.headers,
    token ? { Authorization: `Bearer ${token}` } : {}
  );
  return fetch(`${API_BASE}${path}`, { ...options, headers });
}

function injectAuthModal() {
  if (document.getElementById("authModal")) return;

  document.body.insertAdjacentHTML("beforeend", `
    <div id="authModal" class="auth-modal-overlay" hidden>
      <div class="auth-modal">
        <button class="auth-modal-close" aria-label="Close" type="button">&times;</button>
        <h3>Sign in</h3>
        <p class="auth-modal-sub">We'll email you a 6-digit code &mdash; no password needed.</p>

        <div id="authStepEmail">
          <input type="email" id="authEmailInput" placeholder="you@example.com" autocomplete="email">
          <button id="authSendCodeBtn" class="btn btn-primary" type="button">Send code</button>
        </div>

        <div id="authStepCode" hidden>
          <input type="text" id="authCodeInput" placeholder="6-digit code" inputmode="numeric" maxlength="6">
          <button id="authVerifyBtn" class="btn btn-primary" type="button">Verify</button>
        </div>

        <p id="authError" class="auth-modal-error" hidden></p>
      </div>
    </div>
  `);

  const overlay = document.getElementById("authModal");
  overlay.querySelector(".auth-modal-close").addEventListener("click", hideAuthModal);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) hideAuthModal();
  });

  let pendingEmail = "";

  document.getElementById("authSendCodeBtn").addEventListener("click", async () => {
    const email = document.getElementById("authEmailInput").value.trim();
    if (!email) return;
    setAuthError("");

    try {
      const res = await fetch(`${API_BASE}/login/email/request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not send code.");

      pendingEmail = email;
      document.getElementById("authStepEmail").hidden = true;
      document.getElementById("authStepCode").hidden = false;
      document.getElementById("authCodeInput").focus();
    } catch (e) {
      setAuthError(e.message);
    }
  });

  document.getElementById("authVerifyBtn").addEventListener("click", async () => {
    const code = document.getElementById("authCodeInput").value.trim();
    if (!code) return;
    setAuthError("");

    try {
      const res = await fetch(`${API_BASE}/login/email/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: pendingEmail, code }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Invalid code.");

      setToken(data.token);
      hideAuthModal();
      window.dispatchEvent(new CustomEvent("jarvis-signed-in"));
    } catch (e) {
      setAuthError(e.message);
    }
  });
}

function setAuthError(message) {
  const el = document.getElementById("authError");
  el.textContent = message;
  el.hidden = !message;
}

function showAuthModal() {
  injectAuthModal();
  document.getElementById("authStepEmail").hidden = false;
  document.getElementById("authStepCode").hidden = true;
  document.getElementById("authEmailInput").value = "";
  document.getElementById("authCodeInput").value = "";
  setAuthError("");
  document.getElementById("authModal").hidden = false;
  document.getElementById("authEmailInput").focus();
}

function hideAuthModal() {
  const overlay = document.getElementById("authModal");
  if (overlay) overlay.hidden = true;
}

// Runs on every page that includes this file - swaps the nav's
// "Sign in" link for "Sign out" once a token exists, so state
// carries across pricing.html/chat.html without a shared server
// session.
function initAuthNav() {
  const signInLink = document.getElementById("navSignIn");
  if (!signInLink) return;

  function render() {
    signInLink.textContent = isSignedIn() ? "Sign out" : "Sign in";
  }

  signInLink.addEventListener("click", (e) => {
    e.preventDefault();
    if (isSignedIn()) {
      clearToken();
      render();
      window.dispatchEvent(new CustomEvent("jarvis-signed-out"));
    } else {
      showAuthModal();
    }
  });

  window.addEventListener("jarvis-signed-in", render);
  render();
}

document.addEventListener("DOMContentLoaded", initAuthNav);
