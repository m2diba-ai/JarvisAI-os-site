(function () {
  const CATEGORY_ORDER = ["preferences", "people", "projects", "schedule", "general"];
  const CATEGORY_LABELS = {
    preferences: "Preferences",
    people: "People",
    projects: "Projects",
    schedule: "Schedule",
    general: "General",
  };

  const memoryList = document.getElementById("memoryList");
  const memoryFilter = document.getElementById("memoryFilter");

  let allMemories = [];

  function formatKey(key) {
    return key.replace(/[_-]+/g, " ").trim();
  }
  function formatValue(value) {
    return Array.isArray(value) ? value.join(", ") : String(value);
  }

  async function deleteMemory(key) {
    if (!confirm(`Forget "${formatKey(key)}"?`)) return;
    try {
      await authFetch(`/memory/${encodeURIComponent(key)}`, { method: "DELETE" });
      allMemories = allMemories.filter((m) => m.key !== key);
      render(memoryFilter.value.trim());
    } catch (e) {
      console.error("Could not forget memory:", e);
    }
  }

  function renderItem(memory) {
    const item = document.createElement("div");
    item.className = "jarvis-memory-item";

    const body = document.createElement("div");
    body.className = "jarvis-memory-item-body";

    const keyEl = document.createElement("div");
    keyEl.className = "jarvis-memory-item-key";
    keyEl.textContent = formatKey(memory.key);
    body.appendChild(keyEl);

    const valueEl = document.createElement("div");
    valueEl.className = "jarvis-memory-item-value";
    valueEl.textContent = formatValue(memory.value);
    body.appendChild(valueEl);

    item.appendChild(body);

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "jarvis-memory-item-delete";
    deleteBtn.setAttribute("aria-label", `Forget ${formatKey(memory.key)}`);
    deleteBtn.textContent = "×";
    deleteBtn.addEventListener("click", () => deleteMemory(memory.key));
    item.appendChild(deleteBtn);

    return item;
  }

  function render(query) {
    memoryList.innerHTML = "";
    const q = (query || "").toLowerCase();
    const filtered = q
      ? allMemories.filter(
          (m) => formatKey(m.key).toLowerCase().includes(q) || formatValue(m.value).toLowerCase().includes(q)
        )
      : allMemories;

    if (!filtered.length) {
      const empty = document.createElement("div");
      empty.className = "jarvis-memory-empty";
      empty.textContent = allMemories.length
        ? "No matches found."
        : "Jarvis hasn't remembered anything about you yet.";
      memoryList.appendChild(empty);
      return;
    }

    const groups = {};
    filtered.forEach((m) => {
      const category = CATEGORY_ORDER.includes(m.category) ? m.category : "general";
      (groups[category] = groups[category] || []).push(m);
    });

    CATEGORY_ORDER.forEach((category) => {
      const items = groups[category];
      if (!items || !items.length) return;
      const heading = document.createElement("div");
      heading.className = "jarvis-memory-group-label";
      heading.textContent = CATEGORY_LABELS[category] || category;
      memoryList.appendChild(heading);
      items.forEach((m) => memoryList.appendChild(renderItem(m)));
    });
  }

  async function init() {
    if (!isSignedIn()) {
      memoryList.innerHTML = "";
      const prompt = document.createElement("div");
      prompt.className = "jarvis-memory-empty";
      prompt.textContent = "Sign in from the nav above to see what Jarvis remembers about you.";
      memoryList.appendChild(prompt);
      return;
    }

    try {
      const res = await authFetch("/memory");
      if (res.status === 401) {
        clearToken();
        window.dispatchEvent(new CustomEvent("jarvis-signed-out"));
        return;
      }
      allMemories = await res.json();
      render("");
    } catch (e) {
      console.error("Could not load memory:", e);
      memoryList.innerHTML = "";
      const empty = document.createElement("div");
      empty.className = "jarvis-memory-empty";
      empty.textContent = "Could not reach Jarvis - please try again.";
      memoryList.appendChild(empty);
    }
  }

  memoryFilter.addEventListener("input", () => render(memoryFilter.value.trim()));
  window.addEventListener("jarvis-signed-in", init);
  window.addEventListener("jarvis-signed-out", init);

  init();
})();
