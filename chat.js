// Full ChatGPT-style app logic for chat.html - conversation history,
// streaming replies, search, and the memory link. Auth (isSignedIn,
// authFetch, showAuthModal, API_BASE) comes from auth.js, already
// loaded before this file and shared across the whole site.
(function () {
  const jarvisApp = document.getElementById("jarvisApp");
  const sidebar = document.getElementById("jarvisSidebar");
  const sidebarToggle = document.getElementById("sidebarToggle");
  const sidebarBackdrop = document.getElementById("sidebarBackdrop");

  const chat = document.getElementById("chat");
  const chatScroll = document.getElementById("chatScroll");
  const emptyState = document.getElementById("emptyState");
  const signedOutState = document.getElementById("signedOutState");
  const signInPromptBtn = document.getElementById("signInPromptBtn");
  const composerWrap = document.getElementById("composerWrap");
  const composerHint = document.getElementById("composerHint");
  const planBadge = document.getElementById("planBadge");

  const chatInput = document.getElementById("chatInput");
  const sendBtn = document.getElementById("chatSendBtn");
  const modelPicker = document.getElementById("modelPicker");
  const attachBtn = document.getElementById("attachBtn");
  const imageInput = document.getElementById("imageInput");
  const imagePreviewWrap = document.getElementById("imagePreviewWrap");
  const imagePreview = document.getElementById("imagePreview");
  const imageRemoveBtn = document.getElementById("imageRemoveBtn");

  const userMenuBtn = document.getElementById("userMenuBtn");
  const userMenu = document.getElementById("userMenu");
  const userAvatar = document.getElementById("userAvatar");
  const userLabel = document.getElementById("userLabel");
  const clearBtn = document.getElementById("clearBtn");
  const signOutBtn = document.getElementById("signOutBtn");

  const newChatBtn = document.getElementById("newChatBtn");
  const historyList = document.getElementById("historyList");

  const searchChatBtn = document.getElementById("searchChatBtn");
  const searchModal = document.getElementById("searchModal");
  const searchModalClose = document.getElementById("searchModalClose");
  const searchInput = document.getElementById("searchInput");
  const searchResults = document.getElementById("searchResults");

  let currentConversationId = null;
  let isPro = false;
  let pendingImageBase64 = null;
  let sending = false;
  let searchDebounceTimer = null;

  // ------------------------
  // Sidebar (mobile toggle + user menu)
  // ------------------------

  function openSidebar() {
    sidebar.classList.add("open");
    sidebarBackdrop.classList.add("open");
  }
  function closeSidebar() {
    sidebar.classList.remove("open");
    sidebarBackdrop.classList.remove("open");
  }
  sidebarToggle.addEventListener("click", () => {
    sidebar.classList.contains("open") ? closeSidebar() : openSidebar();
  });
  sidebarBackdrop.addEventListener("click", closeSidebar);

  function closeUserMenu() {
    userMenu.hidden = true;
  }
  userMenuBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    userMenu.hidden = !userMenu.hidden;
  });
  document.addEventListener("click", (e) => {
    if (!userMenu.hidden && !userMenu.contains(e.target) && e.target !== userMenuBtn) closeUserMenu();
  });

  signOutBtn.addEventListener("click", () => {
    clearToken();
    window.dispatchEvent(new CustomEvent("jarvis-signed-out"));
  });

  // ------------------------
  // Rendering
  // ------------------------

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function renderMarkdown(text) {
    let safe = escapeHtml(text);
    safe = safe.replace(/```([\s\S]*?)```/g, (_, code) => `<pre><code>${code.trim()}</code></pre>`);
    safe = safe.replace(/`([^`]+)`/g, "<code>$1</code>");
    safe = safe.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    safe = safe.replace(
      /(https?:\/\/[^\s<>"']+)/g,
      (url) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`
    );
    safe = safe.replace(/\n/g, "<br>");
    return safe;
  }

  function hideEmptyState() {
    emptyState.hidden = true;
  }

  function scrollToBottom() {
    chatScroll.scrollTop = chatScroll.scrollHeight;
  }

  function renderMessage(role, content) {
    hideEmptyState();

    const group = document.createElement("div");
    group.className = `jarvis-msg-group ${role}`;

    const row = document.createElement("div");
    row.className = "jarvis-msg-row";

    if (role === "assistant") {
      const avatar = document.createElement("span");
      avatar.className = "jarvis-msg-avatar";
      row.appendChild(avatar);
    }

    const bubble = document.createElement("div");
    bubble.className = "jarvis-bubble";
    bubble.innerHTML = renderMarkdown(content);
    row.appendChild(bubble);
    group.appendChild(row);

    chat.appendChild(group);
    return { group, bubble };
  }

  function showTyping() {
    hideEmptyState();
    const group = document.createElement("div");
    group.className = "jarvis-msg-group assistant";
    group.id = "typingGroup";

    const row = document.createElement("div");
    row.className = "jarvis-msg-row";

    const avatar = document.createElement("span");
    avatar.className = "jarvis-msg-avatar";
    row.appendChild(avatar);

    const bubble = document.createElement("div");
    bubble.className = "jarvis-bubble jarvis-typing-dots";
    bubble.innerHTML = "<span></span><span></span><span></span>";
    row.appendChild(bubble);

    group.appendChild(row);
    chat.appendChild(group);
    scrollToBottom();
  }

  function hideTyping() {
    const el = document.getElementById("typingGroup");
    if (el) el.remove();
  }

  // ------------------------
  // Sign-in gate
  // ------------------------

  function resetChatView() {
    chat.innerHTML = "";
    emptyState.hidden = false;
  }

  // A 401 encountered anywhere (e.g. fetchConversations() below) fires
  // "jarvis-signed-out", which calls refreshGate() again - re-entrantly,
  // while the FIRST call is still mid-flight through its own awaits.
  // Without a guard, both invocations mutate the same DOM concurrently
  // and interleave (observed: empty-state AND signed-out-state both
  // visible at once). Each call captures its own epoch and bails as
  // soon as a newer call has started, so only the most recent one ever
  // finishes touching the DOM.
  let gateEpoch = 0;

  async function refreshGate() {
    const epoch = ++gateEpoch;
    const stale = () => epoch !== gateEpoch;

    if (!isSignedIn()) {
      isPro = false;
      signedOutState.hidden = false;
      emptyState.hidden = true;
      composerWrap.hidden = true;
      userLabel.textContent = "";
      userAvatar.textContent = "";
      planBadge.textContent = "";
      historyList.innerHTML = "";
      await loadModels();
      return;
    }

    signedOutState.hidden = true;
    composerWrap.hidden = false;

    // Blank for anyone who signed in before auth.js started storing the
    // username - a generic label beats an empty card or a stray "?".
    const email = getUsername();
    userLabel.textContent = email || "Account";
    userAvatar.textContent = (email.charAt(0) || "J").toUpperCase();

    try {
      const res = await authFetch("/billing/status");
      const data = await res.json();
      if (stale()) return;
      isPro = data.plan === "pro";
      planBadge.textContent = isPro ? "Pro" : "Free";
      composerHint.textContent = isPro
        ? "Unlimited chat, every model, image understanding."
        : "Free plan - 20 messages/day on Groq.";
    } catch (e) {
      if (stale()) return;
      isPro = false;
      planBadge.textContent = "";
    }

    if (stale()) return;
    await loadModels();
    if (stale()) return;
    await initConversations();
  }

  // ------------------------
  // Models + image attach
  // ------------------------

  async function loadModels() {
    try {
      const res = await fetch(`${API_BASE}/chat/models`);
      const models = await res.json();
      modelPicker.innerHTML = "";
      models.filter((m) => m.configured).forEach((m) => {
        const option = document.createElement("option");
        option.value = m.id;
        option.textContent = m.pro_only ? `${m.label} (Pro)` : m.label;
        option.disabled = m.pro_only && !isPro;
        modelPicker.appendChild(option);
      });
      modelPicker.disabled = !isSignedIn();
    } catch (e) {
      // Picker stays empty - send() falls back to "groq" regardless.
    }
  }

  function clearImage() {
    pendingImageBase64 = null;
    imageInput.value = "";
    imagePreviewWrap.hidden = true;
    imagePreview.src = "";
  }

  attachBtn.addEventListener("click", () => {
    if (!isPro) {
      alert("Image understanding is a Pro feature - upgrade to unlock it.");
      return;
    }
    imageInput.click();
  });

  imageInput.addEventListener("change", () => {
    const file = imageInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      pendingImageBase64 = dataUrl.split(",")[1];
      imagePreview.src = dataUrl;
      imagePreviewWrap.hidden = false;
    };
    reader.readAsDataURL(file);
  });

  imageRemoveBtn.addEventListener("click", clearImage);

  // ------------------------
  // Conversations: New chat / history / search
  // ------------------------

  function setActiveConversation(id) {
    currentConversationId = id;
    historyList.querySelectorAll(".jarvis-recent-item").forEach((item) => {
      item.classList.toggle("active", Number(item.dataset.id) === id);
    });
  }

  async function loadHistory(conversationId) {
    resetChatView();
    try {
      const url = conversationId ? `/chat_history?conversation_id=${conversationId}` : "/chat_history";
      const res = await authFetch(url);
      if (res.status === 401) {
        clearToken();
        window.dispatchEvent(new CustomEvent("jarvis-signed-out"));
        return;
      }
      const messages = await res.json();
      messages.forEach(([role, content]) => renderMessage(role === "user" ? "user" : "assistant", content));
      scrollToBottom();
    } catch (e) {
      console.error("Could not load chat history:", e);
    }
  }

  async function loadConversation(id) {
    setActiveConversation(id);
    closeSidebar();
    await loadHistory(id);
  }

  function startNewChat() {
    resetChatView();
    setActiveConversation(null);
    closeSidebar();
    chatInput.focus();
  }
  newChatBtn.addEventListener("click", startNewChat);

  async function clearHistory() {
    if (!confirm("Clear your chat history? This can't be undone.")) return;
    try {
      await authFetch("/clear_chat_history", { method: "POST" });
      resetChatView();
      currentConversationId = null;
      refreshRecents();
    } catch (e) {
      console.error("Could not clear history:", e);
    }
  }
  clearBtn.addEventListener("click", clearHistory);

  function groupByDate(conversations) {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const groups = { "Today": [], "Yesterday": [], "Previous 7 days": [], "Previous 30 days": [], "Older": [] };
    conversations.forEach((c) => {
      const updated = new Date((c.updated_at || "").replace(" ", "T"));
      const startOfUpdatedDay = new Date(updated.getFullYear(), updated.getMonth(), updated.getDate());
      const daysAgo = Math.round((startOfToday - startOfUpdatedDay) / 86400000);
      if (isNaN(daysAgo) || daysAgo <= 0) groups["Today"].push(c);
      else if (daysAgo === 1) groups["Yesterday"].push(c);
      else if (daysAgo <= 7) groups["Previous 7 days"].push(c);
      else if (daysAgo <= 30) groups["Previous 30 days"].push(c);
      else groups["Older"].push(c);
    });
    return groups;
  }

  function renderHistoryItem(conversation) {
    const item = document.createElement("div");
    item.className = "jarvis-recent-item";
    item.dataset.id = conversation.id;
    if (conversation.id === currentConversationId) item.classList.add("active");

    const title = document.createElement("span");
    title.className = "jarvis-recent-item-title";
    title.textContent = conversation.title || "New chat";
    item.appendChild(title);

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "jarvis-recent-item-delete";
    deleteBtn.setAttribute("aria-label", "Delete conversation");
    deleteBtn.textContent = "×";
    deleteBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      deleteConversation(conversation.id);
    });
    item.appendChild(deleteBtn);

    item.addEventListener("click", () => loadConversation(conversation.id));
    return item;
  }

  function renderRecents(conversations) {
    historyList.innerHTML = "";
    if (!conversations.length) {
      const empty = document.createElement("div");
      empty.className = "jarvis-recents-empty";
      empty.textContent = "No conversations yet";
      historyList.appendChild(empty);
      return;
    }
    const groups = groupByDate(conversations);
    Object.entries(groups).forEach(([label, items]) => {
      if (!items.length) return;
      const heading = document.createElement("div");
      heading.className = "jarvis-history-label";
      heading.style.margin = "14px 10px 4px";
      heading.textContent = label;
      historyList.appendChild(heading);
      items.forEach((c) => historyList.appendChild(renderHistoryItem(c)));
    });
  }

  // Thrown (not just logged) on 401 so callers below can tell "the
  // token just got invalidated - a fresh refreshGate() is already
  // handling the signed-out UI, do nothing more here" apart from a
  // real network/parsing failure, which should still fall back to a
  // normal empty view.
  class SignedOutError extends Error {}

  async function fetchConversations() {
    const res = await authFetch("/conversations");
    if (res.status === 401) {
      clearToken();
      window.dispatchEvent(new CustomEvent("jarvis-signed-out"));
      throw new SignedOutError();
    }
    return res.json();
  }

  async function refreshRecents() {
    try {
      renderRecents(await fetchConversations());
    } catch (e) {
      if (!(e instanceof SignedOutError)) console.error("Could not load conversations:", e);
    }
  }

  async function initConversations() {
    try {
      const conversations = await fetchConversations();
      renderRecents(conversations);
      if (conversations.length) {
        await loadConversation(conversations[0].id);
      } else {
        resetChatView();
      }
    } catch (e) {
      if (e instanceof SignedOutError) return;
      console.error("Could not initialize conversations:", e);
      resetChatView();
    }
  }

  async function deleteConversation(id) {
    if (!confirm("Delete this conversation? This can't be undone.")) return;
    try {
      await authFetch(`/conversations/${id}`, { method: "DELETE" });
      if (id === currentConversationId) startNewChat();
      refreshRecents();
    } catch (e) {
      console.error("Could not delete conversation:", e);
    }
  }

  // ------------------------
  // Search
  // ------------------------

  function highlightMatch(text, query) {
    const escaped = escapeHtml(text);
    const escapedQuery = escapeHtml(query).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (!escapedQuery) return escaped;
    return escaped.replace(new RegExp(escapedQuery, "ig"), (m) => `<mark>${m}</mark>`);
  }

  function renderSearchResults(results, query) {
    searchResults.innerHTML = "";
    if (!results.length) {
      const empty = document.createElement("div");
      empty.className = "jarvis-search-empty";
      empty.textContent = query ? "No matches found." : "Type to search your chat history.";
      searchResults.appendChild(empty);
      return;
    }
    results.forEach((result) => {
      const item = document.createElement("div");
      item.className = "jarvis-search-result";

      const title = document.createElement("div");
      title.className = "jarvis-search-result-title";
      title.textContent = result.conversation_title || "New chat";
      item.appendChild(title);

      const snippet = document.createElement("div");
      snippet.className = "jarvis-search-result-snippet";
      snippet.innerHTML = highlightMatch(result.content, query);
      item.appendChild(snippet);

      item.addEventListener("click", () => {
        searchModal.hidden = true;
        loadConversation(result.conversation_id);
      });
      searchResults.appendChild(item);
    });
  }

  async function runSearch(query) {
    if (!query) {
      renderSearchResults([], "");
      return;
    }
    try {
      const res = await authFetch(`/search_chat?q=${encodeURIComponent(query)}`);
      if (res.status === 401) return;
      renderSearchResults(await res.json(), query);
    } catch (e) {
      console.error("Could not search chat history:", e);
    }
  }

  searchChatBtn.addEventListener("click", () => {
    searchModal.hidden = false;
    searchInput.value = "";
    renderSearchResults([], "");
    searchInput.focus();
    closeSidebar();
  });
  searchModalClose.addEventListener("click", () => { searchModal.hidden = true; });
  searchModal.addEventListener("click", (e) => { if (e.target === searchModal) searchModal.hidden = true; });
  searchInput.addEventListener("input", () => {
    clearTimeout(searchDebounceTimer);
    const query = searchInput.value.trim();
    searchDebounceTimer = setTimeout(() => runSearch(query), 250);
  });

  // ------------------------
  // Sending messages - streams for the common case (plain Groq text
  // chat), falls back to the non-streaming /chat/web for images or a
  // non-default model, which /chat/stream doesn't support.
  // ------------------------

  async function sendStreaming(text) {
    const res = await authFetch("/chat/stream", {
      method: "POST",
      body: JSON.stringify({ message: text, conversation_id: currentConversationId }),
    });

    if (res.status === 401) {
      hideTyping();
      clearToken();
      window.dispatchEvent(new CustomEvent("jarvis-signed-out"));
      return;
    }
    if (!res.ok || !res.body) throw new Error(`Unexpected response: ${res.status}`);

    hideTyping();
    const { bubble } = renderMessage("assistant", "");
    let fullText = "";

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let boundary;
      while ((boundary = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        if (!frame.startsWith("data: ")) continue;

        const payload = JSON.parse(frame.slice(6));
        if (payload.delta) {
          fullText += payload.delta;
          bubble.innerHTML = renderMarkdown(fullText);
          scrollToBottom();
        } else if (payload.error) {
          fullText += `\n${payload.error}`;
          bubble.innerHTML = renderMarkdown(fullText);
        } else if (payload.done && payload.conversation_id) {
          setActiveConversation(payload.conversation_id);
          refreshRecents();
        }
      }
    }
  }

  async function sendNonStreaming(text, model) {
    const body = { message: text, conversation_id: currentConversationId, model };
    if (pendingImageBase64) body.image = pendingImageBase64;

    const res = await authFetch("/chat/web", { method: "POST", body: JSON.stringify(body) });
    hideTyping();

    if (res.status === 401) {
      clearToken();
      window.dispatchEvent(new CustomEvent("jarvis-signed-out"));
      return;
    }

    const data = await res.json();
    if (!res.ok) {
      renderMessage("system", data.error || "Something went wrong.");
      return;
    }
    setActiveConversation(data.conversation_id);
    renderMessage("assistant", data.reply);
    refreshRecents();
  }

  async function send() {
    const text = chatInput.value.trim();
    if ((!text && !pendingImageBase64) || sending) return;

    const model = modelPicker.value || "groq";
    const usingImage = !!pendingImageBase64;

    renderMessage("user", text || "(image)");
    chatInput.value = "";
    chatInput.style.height = "auto";
    scrollToBottom();

    sending = true;
    sendBtn.disabled = true;
    showTyping();
    clearImage();

    try {
      if (usingImage || model !== "groq") {
        await sendNonStreaming(text, model);
      } else {
        await sendStreaming(text);
      }
    } catch (e) {
      console.error(e);
      hideTyping();
      renderMessage("system", "Could not reach Jarvis - please try again.");
    } finally {
      sending = false;
      sendBtn.disabled = false;
      scrollToBottom();
    }
  }

  sendBtn.addEventListener("click", send);
  chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });
  chatInput.addEventListener("input", () => {
    chatInput.style.height = "auto";
    chatInput.style.height = Math.min(chatInput.scrollHeight, 200) + "px";
  });

  document.querySelectorAll(".jarvis-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      chatInput.value = chip.dataset.text;
      send();
    });
  });

  signInPromptBtn.addEventListener("click", showAuthModal);

  window.addEventListener("jarvis-signed-in", refreshGate);
  window.addEventListener("jarvis-signed-out", () => {
    currentConversationId = null;
    resetChatView();
    refreshGate();
  });

  refreshGate();
})();
