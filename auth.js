// Shared sign-in (email code, no password) + a small fetch wrapper
// used by pricing.html and chat.html - both need to know who's
// signed in and call the hosted API with their token.

const API_BASE = "https://jarvis-api-pzfx.onrender.com";

const TOKEN_KEY = "jarvis_token";
const USERNAME_KEY = "jarvis_username";

function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}
function getUsername() {
  return localStorage.getItem(USERNAME_KEY) || "";
}
// username is optional so older callers keep working - chat.html shows
// it on the account card, and anyone signed in before it started being
// stored just falls back to a generic label rather than breaking.
function setToken(token, username) {
  localStorage.setItem(TOKEN_KEY, token);
  if (username) localStorage.setItem(USERNAME_KEY, username);
}
function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USERNAME_KEY);
}
function isSignedIn() {
  return !!getToken();
}

async function authFetch(path, options = {}) {
  const token = getToken();
  // A FormData body must NOT carry an explicit Content-Type: the
  // browser sets it itself so it can include the multipart boundary,
  // and overriding it here makes the server unable to parse the upload.
  const isFormData = typeof FormData !== "undefined" && options.body instanceof FormData;
  const headers = Object.assign(
    isFormData ? {} : { "Content-Type": "application/json" },
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

        <div id="authGoogleWrap" hidden>
          <div id="authGoogleBtn"></div>
          <div class="auth-modal-divider"><span>or</span></div>
        </div>

        <div id="authStepEmail">
          <input type="email" id="authEmailInput" placeholder="you@example.com" autocomplete="email">
          <button id="authSendCodeBtn" class="btn btn-primary" type="button">Send code</button>
        </div>

        <div class="auth-modal-divider"><span>or use a password</span></div>

        <div id="authStepPassword">
          <input type="text" id="authUsernameInput" placeholder="Username" autocomplete="username">
          <input type="password" id="authPasswordInput" placeholder="Password" autocomplete="current-password">
          <button id="authPasswordBtn" class="btn btn-secondary" type="button">Sign in</button>
          <p class="auth-modal-switch">
            <span id="authSwitchPrompt">Don't have an account?</span>
            <a href="#" id="authSwitchLink">Sign up</a>
          </p>
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

  wirePasswordAuth();
  loadLoginMethods();

  const PENDING_EMAIL_KEY = "jarvis_pending_login_email";

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

      // sessionStorage (not a plain JS variable) so this survives the
      // tab getting reloaded - very likely on mobile, where checking
      // the code means switching away to the email app and back.
      sessionStorage.setItem(PENDING_EMAIL_KEY, email);
      document.getElementById("authStepEmail").hidden = true;
      document.getElementById("authStepCode").hidden = false;
      document.getElementById("authCodeInput").focus();
    } catch (e) {
      setAuthError(e.message);
    }
  });

  document.getElementById("authVerifyBtn").addEventListener("click", async () => {
    const code = document.getElementById("authCodeInput").value.trim();
    const pendingEmail = sessionStorage.getItem(PENDING_EMAIL_KEY);
    if (!code) return;
    if (!pendingEmail) {
      setAuthError("Your session expired - please request a new code.");
      return;
    }
    setAuthError("");

    try {
      const res = await fetch(`${API_BASE}/login/email/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: pendingEmail, code }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Invalid code.");

      sessionStorage.removeItem(PENDING_EMAIL_KEY);
      setToken(data.token, data.username || pendingEmail);
      hideAuthModal();
      window.dispatchEvent(new CustomEvent("jarvis-signed-in"));
    } catch (e) {
      setAuthError(e.message);
    }
  });
}

// --- Username / password ------------------------------------------
// The /register and /login routes have existed all along; this page
// just never offered them, so an account made in the desktop app could
// not sign in here.

let authSignUpMode = false;

function wirePasswordAuth() {
  const usernameInput = document.getElementById("authUsernameInput");
  const passwordInput = document.getElementById("authPasswordInput");
  const submitBtn = document.getElementById("authPasswordBtn");
  const switchLink = document.getElementById("authSwitchLink");

  switchLink.addEventListener("click", (e) => {
    e.preventDefault();
    authSignUpMode = !authSignUpMode;
    submitBtn.textContent = authSignUpMode ? "Create account" : "Sign in";
    document.getElementById("authSwitchPrompt").textContent =
      authSignUpMode ? "Already have an account?" : "Don't have an account?";
    switchLink.textContent = authSignUpMode ? "Sign in" : "Sign up";
    passwordInput.setAttribute(
      "autocomplete",
      authSignUpMode ? "new-password" : "current-password"
    );
    setAuthError("");
  });

  submitBtn.addEventListener("click", async () => {
    const username = usernameInput.value.trim();
    const password = passwordInput.value;
    if (!username || !password) {
      setAuthError("Enter a username and password.");
      return;
    }
    setAuthError("");

    try {
      const res = await fetch(`${API_BASE}/${authSignUpMode ? "register" : "login"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not sign in.");

      setToken(data.token, data.username || username);
      hideAuthModal();
      window.dispatchEvent(new CustomEvent("jarvis-signed-in"));
    } catch (e) {
      setAuthError(e.message);
    }
  });
}

// --- Sign in with Google ------------------------------------------
// Google Identity Services hands the page a signed ID token, which the
// server verifies. Not the desktop flow in google_login.py: that one
// opens a browser and runs a local server on the machine executing it.

function initGoogleSignIn(clientId) {
  if (!clientId) return;

  const script = document.createElement("script");
  script.src = "https://accounts.google.com/gsi/client";
  script.async = true;
  script.onload = () => {
    if (!window.google || !google.accounts) return;

    google.accounts.id.initialize({
      client_id: clientId,
      callback: async (response) => {
        try {
          const res = await fetch(`${API_BASE}/login/google/token`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ credential: response.credential }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "Google sign-in failed.");

          setToken(data.token, data.username);
          hideAuthModal();
          window.dispatchEvent(new CustomEvent("jarvis-signed-in"));
        } catch (e) {
          setAuthError(e.message);
        }
      },
    });

    google.accounts.id.renderButton(document.getElementById("authGoogleBtn"), {
      theme: "filled_black",
      size: "large",
      width: 280,
      text: "continue_with",
    });
    document.getElementById("authGoogleWrap").hidden = false;
  };
  document.head.appendChild(script);
}

async function loadLoginMethods() {
  try {
    const res = await fetch(`${API_BASE}/login/methods`);
    if (!res.ok) return;
    initGoogleSignIn((await res.json()).google_client_id);
  } catch (e) {
    // Unreachable server - the forms will say so clearly on first use.
  }
}

function setAuthError(message) {
  const el = document.getElementById("authError");
  el.textContent = message;
  el.hidden = !message;
}

function showAuthModal() {
  injectAuthModal();
  document.getElementById("authStepEmail").hidden = false;
  document.getElementById("authUsernameInput").value = "";
  document.getElementById("authPasswordInput").value = "";
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
