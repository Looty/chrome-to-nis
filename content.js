const CURRENCY_DEFS = [
  { code: "USD", tokens: ["US$", "$", "USD"] },
  { code: "EUR", tokens: ["EUR", "€"] },
  { code: "GBP", tokens: ["GBP", "£"] },
  { code: "JPY", tokens: ["JPY", "¥"] },
  { code: "CAD", tokens: ["CA$", "C$", "CAD"] },
  { code: "AUD", tokens: ["AU$", "AUD"] },
  { code: "NZD", tokens: ["NZ$", "NZD"] },
  { code: "HKD", tokens: ["HK$", "HKD"] },
  { code: "SGD", tokens: ["S$", "SGD"] },
  { code: "CHF", tokens: ["CHF"] },
  { code: "CNY", tokens: ["CNY", "RMB", "CN¥"] }
];

const TOKEN_TO_CODE = new Map();
const TOKEN_PATTERN = buildTokenPattern();
const NUMBER_PATTERN = String.raw`(?:\d{1,3}(?:[,\s]\d{3})+|\d+)(?:[.,]\d{1,2})?`;
const PRICE_REGEX = new RegExp(
  String.raw`(?:^|[^\p{L}\p{N}])(?:(${TOKEN_PATTERN})\s*(${NUMBER_PATTERN})|(${NUMBER_PATTERN})\s*(${TOKEN_PATTERN}))(?![\p{L}\p{N}])`,
  "giu"
);

let lastContext = {
  x: 0,
  y: 0,
  selectionRect: null,
  target: null
};
let lastSelectionSnapshot = {
  text: "",
  rect: null
};

let activeTooltip = null;
const TOOLTIP_TOKENS = {
  width: 252,
  baseCountdownMs: 5000,
  perDetailMs: 1000,
  radius: 16,
  railWidth: 6
};

// Guard against double-injection: the background falls back to
// scripting.executeScript when the static script doesn't answer.
if (!window.__toNisLoaded) {
  window.__toNisLoaded = true;

  document.addEventListener(
    "contextmenu",
    (event) => {
      const selection = window.getSelection();
      const hasSelection = selection && selection.toString().trim();
      const selectionRect = hasSelection && selection.rangeCount
        ? getSelectionAnchorRect(selection, event.clientX, event.clientY)
        : null;

      if (hasSelection && selectionRect) {
        lastSelectionSnapshot = {
          text: selection.toString().trim(),
          rect: selectionRect
        };
      }

      lastContext = {
        x: event.clientX,
        y: event.clientY,
        selectionRect,
        target: event.target instanceof Element ? event.target : event.target?.parentElement || null
      };
    },
    true
  );

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "TO_NIS_RUN") {
      return undefined;
    }

    handleRun(message).then(
      () => sendResponse({ ok: true }),
      (error) => {
        console.error("Failed to run To NIS", error);
        showTooltip({
          kind: "error",
          title: "Conversion failed",
          subtitle: error instanceof Error ? error.message : "Unknown error",
          timestampText: "No rates available"
        });
        sendResponse({ ok: false });
      }
    );

    return true;
  });
}

async function handleRun(message) {
  if (message.mode === "selection") {
    const liveSelection = window.getSelection();
    const liveSelectionText = liveSelection?.toString().trim() || "";
    const matchingSnapshot = lastSelectionSnapshot.text && message.selectionText
      ? normalizeSelectionText(lastSelectionSnapshot.text) === normalizeSelectionText(message.selectionText)
      : false;

    if (liveSelectionText && liveSelection.rangeCount) {
      lastContext.selectionRect = getSelectionAnchorRect(liveSelection, lastContext.x, lastContext.y);
    } else if (matchingSnapshot && lastSelectionSnapshot.rect) {
      lastContext.selectionRect = lastSelectionSnapshot.rect;
    }
  }

  const parsedPrices = message.mode === "selection"
    ? parsePriceText(message.selectionText || "")
    : parsePricesFromElement(lastContext.target);

  if (!parsedPrices.length) {
    showTooltip({
      kind: "error",
      title: "No foreign prices found",
      subtitle: "Try selecting a price or right-clicking a more specific element.",
      timestampText: "Nothing to convert"
    });
    return;
  }

  const response = await chrome.runtime.sendMessage({
    type: "TO_NIS_CONVERT",
    prices: parsedPrices
  });

  if (!response?.ok) {
    throw new Error(response?.error || "Could not convert prices.");
  }

  showConversionTooltip(response.results);
}

function parsePricesFromElement(element) {
  if (!(element instanceof Element)) {
    return [];
  }

  const text = element.innerText || element.textContent || "";
  return dedupeArtifactPrices(parseMatches(text));
}

function parsePriceText(text) {
  return dedupeArtifactPrices(parseMatches(text || ""));
}

function parseMatches(text) {
  const results = [];

  for (const match of text.matchAll(PRICE_REGEX)) {
    const prefixToken = match[1];
    const prefixNumber = match[2];
    const suffixNumber = match[3];
    const suffixToken = match[4];
    const token = prefixToken || suffixToken;
    const rawNumber = prefixNumber || suffixNumber;
    const currencyCode = TOKEN_TO_CODE.get(token.toUpperCase());

    if (!currencyCode) {
      continue;
    }

    const amount = normalizeAmount(rawNumber);
    if (amount == null || amount <= 0) {
      continue;
    }

    const raw = match[0].trim();
    const numberDigits = rawNumber.replace(/\D/g, "");

    results.push({
      raw,
      amount,
      currencyCode,
      currencyToken: token,
      numberDigits,
      index: match.index || 0
    });
  }

  return results;
}

function dedupeArtifactPrices(matches) {
  const deduped = [];
  const sorted = [...matches].sort((a, b) => a.index - b.index || a.raw.length - b.raw.length);

  for (const current of sorted) {
    const shouldSkip = sorted.some((candidate) => {
      if (candidate === current) {
        return false;
      }

      if (candidate.currencyCode !== current.currencyCode) {
        return false;
      }

      const closeBy = Math.abs(candidate.index - current.index) <= 12;
      const candidateHasNoDecimals = !/[.,]\d{1,2}/.test(candidate.raw);
      const currentLooksSplitArtifact =
        candidateHasNoDecimals &&
        current.numberDigits.startsWith(candidate.numberDigits) &&
        current.numberDigits.length === candidate.numberDigits.length + 2 &&
        current.amount >= candidate.amount * 10;

      return closeBy && currentLooksSplitArtifact;
    });

    if (!shouldSkip) {
      const alreadySeen = deduped.some(
        (item) =>
          item.currencyCode === current.currencyCode &&
          item.amount === current.amount &&
          Math.abs(item.index - current.index) <= 2
      );

      if (!alreadySeen) {
        deduped.push(current);
      }
    }
  }

  return deduped;
}

function normalizeAmount(rawNumber) {
  const compact = rawNumber.replace(/\s+/g, "");
  const lastDot = compact.lastIndexOf(".");
  const lastComma = compact.lastIndexOf(",");
  const lastSeparator = Math.max(lastDot, lastComma);

  if (lastSeparator === -1) {
    const plain = compact.replace(/[^\d]/g, "");
    return plain ? Number.parseFloat(plain) : null;
  }

  const decimalDigits = compact.length - lastSeparator - 1;
  const separator = compact[lastSeparator];

  if (decimalDigits === 0 || decimalDigits > 2) {
    const stripped = compact.replace(/[^\d]/g, "");
    return stripped ? Number.parseFloat(stripped) : null;
  }

  let normalized = compact;
  if (separator === ".") {
    normalized = normalized.replace(/,/g, "");
  } else {
    normalized = normalized.replace(/\./g, "").replace(",", ".");
  }

  const value = Number.parseFloat(normalized);
  return Number.isFinite(value) ? value : null;
}

function buildTokenPattern() {
  const tokens = [];
  for (const definition of CURRENCY_DEFS) {
    for (const token of definition.tokens) {
      TOKEN_TO_CODE.set(token.toUpperCase(), definition.code);
      tokens.push(escapeRegex(token));
    }
  }

  return tokens.sort((a, b) => b.length - a.length).join("|");
}

function showConversionTooltip(results) {
  const hasWarning = results.some((result) => result.rateInfo.cacheStatus === "stale-fallback");
  const newestFetchedAt = Math.max(...results.map((result) => result.rateInfo.fetchedAt));
  const stalestAge = Math.max(...results.map((result) => result.rateInfo.staleMs));

  if (results.length === 1) {
    const [result] = results;
    showTooltip({
      kind: hasWarning ? "warning" : "success",
      title: formatNis(result.convertedAmount),
      subtitle: `1 ${result.currencyCode} = ${formatRate(result.rateInfo.rate)} NIS`,
      timestampText: buildTimestampText(result.rateInfo)
    });
    return;
  }

  showTooltip({
    kind: hasWarning ? "warning" : "success",
    title: `${results.length} prices converted`,
    subtitle: `Latest rate update ${formatRelativeAge(Date.now() - newestFetchedAt)} ago`,
    timestampText: `Stalest cached rate: ${formatRelativeAge(stalestAge)} ago`,
    details: results.map((result) => ({
      label: result.raw,
      value: formatNis(result.convertedAmount),
      meta: `${result.currencyCode} at ${formatRate(result.rateInfo.rate)}`
    }))
  });
}

function showTooltip({ kind, title, subtitle, timestampText, details = [] }) {
  activeTooltip?.destroy();
  activeTooltip = createTooltip({ kind, title, subtitle, timestampText, details });
  activeTooltip.show();
}

function createTooltip({ kind, title, subtitle, timestampText, details }) {
  const host = document.createElement("div");
  host.style.position = "fixed";
  host.style.left = "0";
  host.style.top = "0";
  host.style.zIndex = "2147483647";

  const countdownMs = TOOLTIP_TOKENS.baseCountdownMs + TOOLTIP_TOKENS.perDetailMs * Math.min(details.length, 8);

  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = `
    :host {
      all: initial;
    }
    .card {
      --text-primary: #0f172a;
      --text-secondary: #334155;
      --text-muted: #64748b;
      --border: rgba(148, 163, 184, 0.28);
      --surface: rgba(255, 255, 255, 0.96);
      --surface-strong: rgba(255, 255, 255, 0.99);
      --detail-bg: rgba(255, 255, 255, 0.56);
      --detail-border: rgba(148, 163, 184, 0.16);
      --detail-inset: rgba(255, 255, 255, 0.45);
      --close-bg: rgba(255, 255, 255, 0.62);
      --close-bg-hover: rgba(255, 255, 255, 0.96);
      --shadow: 0 18px 42px rgba(15, 23, 42, 0.18), 0 6px 18px rgba(255, 255, 255, 0.32);

      position: relative;
      overflow: hidden;
      width: min(${TOOLTIP_TOKENS.width}px, calc(100vw - 24px));
      box-sizing: border-box;
      padding: 12px 12px 12px 16px;
      border-radius: ${TOOLTIP_TOKENS.radius}px;
      border: 1px solid var(--border);
      background: linear-gradient(180deg, var(--surface-strong), var(--surface));
      color: var(--text-primary);
      box-shadow: var(--shadow);
      font-family: "Segoe UI", ui-sans-serif, system-ui, sans-serif;
      font-variant-numeric: tabular-nums;
      cursor: grab;
      user-select: none;
    }
    @media (prefers-color-scheme: dark) {
      .card {
        --text-primary: #f1f5f9;
        --text-secondary: #cbd5e1;
        --text-muted: #94a3b8;
        --border: rgba(148, 163, 184, 0.3);
        --surface: rgba(30, 41, 59, 0.97);
        --surface-strong: rgba(36, 48, 68, 0.99);
        --detail-bg: rgba(255, 255, 255, 0.06);
        --detail-border: rgba(148, 163, 184, 0.2);
        --detail-inset: rgba(255, 255, 255, 0.08);
        --close-bg: rgba(255, 255, 255, 0.08);
        --close-bg-hover: rgba(255, 255, 255, 0.18);
        --shadow: 0 18px 42px rgba(0, 0, 0, 0.45);
      }
    }
    .card.dragging {
      cursor: grabbing;
    }
    .timer {
      position: absolute;
      inset: 0 auto 0 0;
      width: ${TOOLTIP_TOKENS.railWidth}px;
      border-radius: ${TOOLTIP_TOKENS.radius}px 0 0 ${TOOLTIP_TOKENS.radius}px;
      transform-origin: top;
      box-shadow: inset -1px 0 0 rgba(255, 255, 255, 0.35);
      animation: to-nis-countdown ${countdownMs}ms linear forwards;
    }
    .card.paused .timer {
      animation-play-state: paused;
    }
    @keyframes to-nis-countdown {
      from { transform: scaleY(1); }
      to { transform: scaleY(0); }
    }
    .timer.success {
      background: linear-gradient(180deg, #34d399, #16a34a);
    }
    .timer.warning {
      background: linear-gradient(180deg, #fbbf24, #d97706);
    }
    .timer.error {
      background: linear-gradient(180deg, #fb7185, #dc2626);
    }
    .body {
      position: relative;
      display: grid;
      gap: 8px;
      padding-left: 2px;
    }
    .header {
      display: grid;
      gap: 4px;
      padding-right: 24px;
    }
    .close {
      position: absolute;
      z-index: 1;
      top: 8px;
      right: 8px;
      width: 22px;
      height: 22px;
      border: 1px solid var(--detail-border);
      border-radius: 999px;
      background: var(--close-bg);
      color: var(--text-muted);
      font-size: 14px;
      line-height: 20px;
      cursor: pointer;
      transition: transform 140ms ease, background 140ms ease, color 140ms ease;
    }
    .close:hover {
      background: var(--close-bg-hover);
      color: var(--text-primary);
    }
    .close:active {
      transform: scale(0.95);
    }
    .title {
      margin: 0;
      font: 700 21px/1.08 "Segoe UI", ui-sans-serif, system-ui, sans-serif;
      letter-spacing: -0.02em;
    }
    .subtitle {
      margin: 0;
      color: var(--text-secondary);
      font: 600 12px/1.35 "Segoe UI", ui-sans-serif, system-ui, sans-serif;
    }
    .stamp {
      color: var(--text-muted);
      font: 500 11px/1.35 "Segoe UI", ui-sans-serif, system-ui, sans-serif;
    }
    .details {
      display: grid;
      gap: 6px;
    }
    .detail {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 6px 8px;
      align-items: center;
      padding: 7px 8px;
      border-radius: 10px;
      border: 1px solid var(--detail-border);
      background: var(--detail-bg);
      box-shadow: inset 0 1px 0 var(--detail-inset);
    }
    .detail-main {
      min-width: 0;
      display: grid;
      gap: 3px;
    }
    .detail-label {
      color: var(--text-secondary);
      font: 600 12px/1.35 "Segoe UI", ui-sans-serif, system-ui, sans-serif;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .detail-meta {
      color: var(--text-muted);
      font: 500 11px/1.35 "Segoe UI", ui-sans-serif, system-ui, sans-serif;
    }
    .detail-value {
      color: var(--text-primary);
      font: 700 14px/1.2 "Segoe UI", ui-sans-serif, system-ui, sans-serif;
      letter-spacing: -0.02em;
      text-align: right;
      white-space: nowrap;
    }
  `;

  const card = document.createElement("div");
  card.className = "card";
  card.setAttribute("role", "status");
  card.setAttribute("aria-live", "polite");

  const timer = document.createElement("div");
  timer.className = `timer ${kind === "error" ? "error" : kind === "warning" ? "warning" : "success"}`;

  const close = document.createElement("button");
  close.className = "close";
  close.type = "button";
  close.textContent = "×";
  close.setAttribute("aria-label", "Dismiss");

  const body = document.createElement("div");
  body.className = "body";

  const header = document.createElement("div");
  header.className = "header";

  const titleElement = document.createElement("div");
  titleElement.className = "title";
  titleElement.textContent = title;

  const subtitleElement = document.createElement("p");
  subtitleElement.className = "subtitle";
  subtitleElement.textContent = subtitle;

  const timestampElement = document.createElement("div");
  timestampElement.className = "stamp";
  timestampElement.textContent = timestampText;

  header.append(titleElement, subtitleElement, timestampElement);
  body.append(header);
  card.append(timer, close, body);

  if (details.length) {
    const detailsWrap = document.createElement("div");
    detailsWrap.className = "details";

    for (const item of details.slice(0, 8)) {
      const detail = document.createElement("div");
      detail.className = "detail";

      if (typeof item === "string") {
        detail.textContent = item;
      } else {
        const main = document.createElement("div");
        main.className = "detail-main";

        const label = document.createElement("div");
        label.className = "detail-label";
        label.textContent = item.label;

        const meta = document.createElement("div");
        meta.className = "detail-meta";
        meta.textContent = item.meta;

        const value = document.createElement("div");
        value.className = "detail-value";
        value.textContent = item.value;

        main.append(label, meta);
        detail.append(main, value);
      }

      detailsWrap.appendChild(detail);
    }

    body.appendChild(detailsWrap);
  }

  shadow.append(style, card);
  document.documentElement.appendChild(host);

  let dismissed = false;
  let dragOffsetX = 0;
  let dragOffsetY = 0;
  let hoverPause = false;
  let dragPause = false;

  function syncPaused() {
    card.classList.toggle("paused", hoverPause || dragPause);
  }

  function destroy() {
    if (dismissed) {
      return;
    }

    dismissed = true;
    document.removeEventListener("keydown", onKeyDown, true);
    host.remove();
    if (activeTooltip?.destroy === destroy) {
      activeTooltip = null;
    }
  }

  function onKeyDown(event) {
    if (event.key === "Escape") {
      destroy();
    }
  }

  function startDrag(event) {
    if (!(event instanceof PointerEvent) || event.target === close) {
      return;
    }

    dragPause = true;
    syncPaused();
    card.classList.add("dragging");
    const rect = host.getBoundingClientRect();
    dragOffsetX = event.clientX - rect.left;
    dragOffsetY = event.clientY - rect.top;
    card.setPointerCapture(event.pointerId);
  }

  function moveDrag(event) {
    if (!card.classList.contains("dragging")) {
      return;
    }

    const nextLeft = clamp(event.clientX - dragOffsetX, 8, window.innerWidth - host.offsetWidth - 8);
    const nextTop = clamp(event.clientY - dragOffsetY, 8, window.innerHeight - host.offsetHeight - 8);
    host.style.left = `${nextLeft}px`;
    host.style.top = `${nextTop}px`;
  }

  function endDrag(event) {
    if (!(event instanceof PointerEvent) || !card.classList.contains("dragging")) {
      return;
    }

    card.classList.remove("dragging");
    card.releasePointerCapture(event.pointerId);
    dragPause = false;
    syncPaused();
  }

  function onMouseEnter() {
    hoverPause = true;
    syncPaused();
  }

  function onMouseLeave() {
    hoverPause = false;
    syncPaused();
  }

  timer.addEventListener("animationend", destroy);
  close.addEventListener("click", destroy);
  card.addEventListener("pointerdown", startDrag);
  card.addEventListener("pointermove", moveDrag);
  card.addEventListener("pointerup", endDrag);
  card.addEventListener("pointercancel", endDrag);
  card.addEventListener("mouseenter", onMouseEnter);
  card.addEventListener("mouseleave", onMouseLeave);
  document.addEventListener("keydown", onKeyDown, true);

  function show() {
    positionTooltip(host);
  }

  return { show, destroy };
}

function positionTooltip(host) {
  const margin = 8;
  const rect = host.getBoundingClientRect();
  const anchorRect = lastContext.selectionRect || getTargetRect(lastContext.target);
  const isSelectionAnchor = Boolean(lastContext.selectionRect);

  if (anchorRect && isSelectionAnchor) {
    const anchorHeight = anchorRect.bottom - anchorRect.top;
    const rightSideLeft = anchorRect.right + margin;
    const leftSideLeft = anchorRect.left - rect.width - margin;
    const canFitRight = rightSideLeft + rect.width <= window.innerWidth - margin;
    const canFitLeft = leftSideLeft >= margin;
    const left = canFitRight
      ? rightSideLeft
      : canFitLeft
        ? leftSideLeft
        : clamp(anchorRect.left + ((anchorRect.right - anchorRect.left) / 2) - (rect.width / 2), margin, window.innerWidth - rect.width - margin);
    const top = clamp(
      anchorRect.top + (anchorHeight / 2) - (rect.height / 2),
      margin,
      window.innerHeight - rect.height - margin
    );

    host.style.left = `${left}px`;
    host.style.top = `${top}px`;
    return;
  }

  const preferredTop = anchorRect ? anchorRect.top - rect.height - margin : lastContext.y - rect.height - margin;
  const hasRoomAbove = preferredTop >= margin;
  const top = hasRoomAbove
    ? preferredTop
    : anchorRect
      ? anchorRect.bottom + margin
      : lastContext.y + margin;
  const preferredLeft = anchorRect
    ? anchorRect.left + ((anchorRect.right - anchorRect.left) / 2) - (rect.width / 2)
    : lastContext.x - (rect.width / 2);
  const left = clamp(preferredLeft, margin, window.innerWidth - rect.width - margin);

  host.style.left = `${left}px`;
  host.style.top = `${clamp(top, margin, window.innerHeight - rect.height - margin)}px`;
}

function getSelectionAnchorRect(selection, clickX, clickY) {
  const range = selection.getRangeAt(0);
  const clientRects = [...range.getClientRects()]
    .filter((rect) => rect.width > 0 && rect.height > 0)
    .map(toPlainRect);

  if (!clientRects.length) {
    return toPlainRect(range.getBoundingClientRect());
  }

  const containingRect = clientRects.find((rect) =>
    clickX >= rect.left &&
    clickX <= rect.right &&
    clickY >= rect.top &&
    clickY <= rect.bottom
  );

  if (containingRect) {
    return containingRect;
  }

  return clientRects.reduce((closest, rect) => {
    const closestDistance = distanceToRectCenter(clickX, clickY, closest);
    const currentDistance = distanceToRectCenter(clickX, clickY, rect);
    return currentDistance < closestDistance ? rect : closest;
  });
}

function getTargetRect(target) {
  if (!(target instanceof Element)) {
    return null;
  }

  return toPlainRect(target.getBoundingClientRect());
}

function toPlainRect(rect) {
  return {
    top: rect.top,
    left: rect.left,
    bottom: rect.bottom,
    right: rect.right
  };
}

function distanceToRectCenter(x, y, rect) {
  const centerX = rect.left + ((rect.right - rect.left) / 2);
  const centerY = rect.top + ((rect.bottom - rect.top) / 2);
  return Math.hypot(centerX - x, centerY - y);
}

function normalizeSelectionText(text) {
  return text.replace(/\s+/g, " ").trim();
}

function formatNis(amount) {
  return new Intl.NumberFormat("en-IL", {
    style: "currency",
    currency: "ILS",
    maximumFractionDigits: 2
  }).format(amount);
}

function formatRate(rate) {
  return rate.toFixed(rate >= 100 ? 2 : 4).replace(/\.?0+$/, "");
}

function buildTimestampText(rateInfo) {
  const age = formatRelativeAge(rateInfo.staleMs);
  if (rateInfo.cacheStatus === "fresh") {
    return "Rate fetched just now";
  }
  if (rateInfo.cacheStatus === "stale-fallback") {
    return `Using cached rate from ${age} ago`;
  }
  return `Rate fetched ${age} ago`;
}

function formatRelativeAge(milliseconds) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }

  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) {
    return `${totalMinutes}m`;
  }

  const totalHours = Math.floor(totalMinutes / 60);
  return `${totalHours}h ${totalMinutes % 60}m`;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
