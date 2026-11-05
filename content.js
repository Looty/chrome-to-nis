// Whole file runs inside a guard: top-level const/let would throw on a second
// injection (background fallback), so the guard has to wrap the declarations too.
(() => {
if (window.__toNisLoaded) {
  return;
}
window.__toNisLoaded = true;

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
  { code: "CNY", tokens: ["CNY", "RMB", "CN¥"] },
  // Shekel prices are converted the other way round, to USD.
  { code: "ILS", tokens: ["₪", "NIS", "ILS", "ש\"ח", "ש״ח"] }
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
  baseCountdownMs: 5000,
  perDetailMs: 1000
};
const MAX_DETAILS = 8;
const SIDES = ["top", "bottom", "left", "right"];
let bubbleSide = "top";
try {
  chrome.storage.local.get("bubbleSide").then((stored) => {
    if (SIDES.includes(stored.bubbleSide)) {
      bubbleSide = stored.bubbleSide;
    }
  });
} catch {
  // Storage is only a convenience; the default side still works.
}
const CHIP_LIFETIME_MS = 12000;
const MAX_SCAN_NODES = 4000;
const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "INPUT"]);

{
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
  let selectionText = message.selectionText || "";

  if (message.mode === "selection") {
    const liveSelection = window.getSelection();
    const liveSelectionText = liveSelection?.toString().trim() || "";
    // The keyboard shortcut carries no text: read the live selection instead.
    selectionText = selectionText || liveSelectionText;
    const matchingSnapshot = lastSelectionSnapshot.text && message.selectionText
      ? normalizeSelectionText(lastSelectionSnapshot.text) === normalizeSelectionText(message.selectionText)
      : false;

    if (liveSelectionText && liveSelection.rangeCount) {
      lastContext.selectionRect = getSelectionAnchorRect(liveSelection, lastContext.x, lastContext.y);
    } else if (matchingSnapshot && lastSelectionSnapshot.rect) {
      lastContext.selectionRect = lastSelectionSnapshot.rect;
    } else if (message.source === "shortcut") {
      // No right-click happened, so any stored position is stale.
      lastContext = { x: 0, y: 0, selectionRect: null, target: null };
    }

    if (!selectionText) {
      showTooltip({
        kind: "error",
        title: "Nothing selected",
        subtitle: "Select a price, then press the shortcut again.",
        timestampText: "Nothing to convert"
      });
      return;
    }
  }

  const parsedPrices = message.mode === "selection"
    ? parsePriceText(selectionText)
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

  showConversionTooltip(response.results, getScope(message.mode));
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

// Footnote presentation: the price on the page gets a dotted underline and the
// NIS value appears on it (a bubble for one price, inline chips for several).
// Everything lives in a fixed shadow-DOM layer; the page's own DOM is untouched.

function getScope(mode) {
  if (mode === "selection") {
    const selection = window.getSelection();
    if (selection?.rangeCount && selection.toString().trim()) {
      const range = selection.getRangeAt(0);
      return { root: range.commonAncestorContainer, range };
    }
    return null;
  }

  return lastContext.target ? { root: lastContext.target, range: null } : null;
}

// Finds a DOM Range for each converted price so the footnote can sit on it.
// Entries are null when a price can't be located (e.g. split across elements).
function locatePrices(scope, results) {
  const rootElement = scope.root instanceof Element ? scope.root : scope.root.parentElement;
  if (!rootElement) {
    return results.map(() => null);
  }

  const nodes = [];
  const walker = document.createTreeWalker(rootElement, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || SKIP_TAGS.has(parent.tagName)) {
        return NodeFilter.FILTER_REJECT;
      }
      if (scope.range && !scope.range.intersectsNode(node)) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    }
  });
  while (nodes.length < MAX_SCAN_NODES && walker.nextNode()) {
    nodes.push(walker.currentNode);
  }

  const used = new Set();
  return results.map((result) => {
    const pattern = new RegExp(escapeRegex(result.raw).replace(/\s+/g, "\\s+"), "g");

    for (const node of nodes) {
      pattern.lastIndex = 0;
      for (const match of node.data.matchAll(pattern)) {
        const start = match.index;
        const end = start + match[0].length;
        const key = `${nodes.indexOf(node)}:${start}`;
        const inSelection = !scope.range ||
          (scope.range.comparePoint(node, start) === 0 && scope.range.comparePoint(node, end) === 0);

        if (used.has(key) || !inSelection) {
          continue;
        }

        used.add(key);
        const range = document.createRange();
        range.setStart(node, start);
        range.setEnd(node, end);
        return range;
      }
    }

    return null;
  });
}

function showConversionTooltip(results, scope) {
  const located = scope ? locatePrices(scope, results) : results.map(() => null);
  const hasWarning = results.some((result) => result.rateInfo.cacheStatus === "stale-fallback");
  const kind = hasWarning ? "warning" : "success";

  if (results.length === 1) {
    const [result] = results;
    const [range] = located;
    showOverlay({
      kind,
      marks: range ? [{ range, result, chip: false }] : [],
      anchorFn: range ? () => toPlainRect(range.getBoundingClientRect()) : null,
      bubble: {
        title: formatResult(result),
        subtitle: rateLine(result),
        stamp: buildTimestampText(result.rateInfo),
        copyText: result.convertedAmount.toFixed(2)
      }
    });
    return;
  }

  if (located.every(Boolean)) {
    showOverlay({
      kind,
      marks: results.map((result, index) => ({ range: located[index], result, chip: true })),
      anchorFn: null,
      bubble: null
    });
    return;
  }

  const newestFetchedAt = Math.max(...results.map((result) => result.rateInfo.fetchedAt));
  const stalestAge = Math.max(...results.map((result) => result.rateInfo.staleMs));
  // A total only makes sense when every price converts to the same currency.
  const targets = new Set(results.map((result) => result.targetCurrency));
  const total = results.reduce((sum, result) => sum + result.convertedAmount, 0);
  const ageText = `rates ${formatRelativeAge(Date.now() - newestFetchedAt)} old`;

  showOverlay({
    kind,
    marks: [],
    anchorFn: null,
    bubble: {
      title: `${results.length} prices converted`,
      subtitle: targets.size === 1
        ? `Total ${formatMoney(total, [...targets][0])} · ${ageText}`
        : `Mixed currencies · ${ageText}`,
      stamp: `Stalest cached rate: ${formatRelativeAge(stalestAge)} ago`,
      details: results.map((result) => ({
        label: result.raw,
        value: formatResult(result),
        meta: `${result.currencyCode} at ${formatRate(result.rateInfo.rate)}`
      }))
    }
  });
}

function showTooltip({ kind, title, subtitle, timestampText, details = [] }) {
  showOverlay({
    kind,
    marks: [],
    anchorFn: null,
    bubble: { title, subtitle, stamp: timestampText, details }
  });
}

function showOverlay(config) {
  activeTooltip?.destroy();
  activeTooltip = createOverlay(config);
}

function copyToClipboard(text, onDone) {
  try {
    Promise.resolve(navigator.clipboard?.writeText(text)).then(onDone, () => {});
  } catch {
    // Clipboard can be blocked on some pages; copying is a convenience only.
  }
}

function createOverlay({ kind, marks, anchorFn, bubble }) {
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;inset:0;z-index:2147483647;pointer-events:none;";

  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .layer {
      --accent: #14803c;
      --accent-soft: #dcf3e4;
      --warn: #b45309;
      --warn-soft: #fdecc8;
      position: fixed;
      inset: 0;
      font-family: "Segoe UI", ui-sans-serif, system-ui, sans-serif;
      font-variant-numeric: tabular-nums;
    }
    @media (prefers-color-scheme: dark) {
      .layer {
        --accent: #3ddc8a;
        --accent-soft: #163a27;
        --warn: #f2a93b;
        --warn-soft: #3d2a0b;
      }
    }
    .underline {
      position: fixed;
      height: 0;
      border-bottom: 2px dotted var(--accent);
    }
    .layer.warning .underline { border-bottom-color: var(--warn); }
    .chip {
      position: fixed;
      pointer-events: auto;
      padding: 4px 10px;
      border: 1px solid var(--accent);
      border-radius: 999px;
      background: var(--accent-soft);
      color: var(--accent);
      font: 700 15px/1.2 ui-monospace, "Cascadia Mono", Consolas, monospace;
      white-space: nowrap;
      cursor: copy;
      box-shadow: 0 3px 10px rgba(0, 0, 0, 0.18);
    }
    .chip.warn { border-color: var(--warn); background: var(--warn-soft); color: var(--warn); }
    .bubble {
      position: fixed;
      pointer-events: auto;
      width: max-content;
      min-width: min(220px, calc(100vw - 16px));
      max-width: min(300px, calc(100vw - 16px));
      padding: 12px 16px 16px;
      border-radius: 12px;
      border: 1px solid rgba(255, 255, 255, 0.14);
      background: #0f1a15;
      color: #e8f2ec;
      box-shadow: 0 14px 34px rgba(0, 0, 0, 0.35);
      display: grid;
      gap: 3px;
      overflow: visible;
    }
    .bubble { cursor: grab; user-select: none; touch-action: none; }
    .bubble.dragging { cursor: grabbing; }
    .bubble.dragging .arrow { display: none; }
    .arrow {
      position: absolute;
      width: 10px;
      height: 10px;
      background: #0f1a15;
      border: 1px solid rgba(255, 255, 255, 0.14);
      transform: rotate(45deg);
    }
    .arrow.down { bottom: -6px; border-top: 0; border-left: 0; }
    .arrow.up { top: -6px; border-bottom: 0; border-right: 0; }
    .arrow.right { right: -6px; border-bottom: 0; border-left: 0; }
    .arrow.left { left: -6px; border-top: 0; border-right: 0; }
    .title {
      font: 700 26px/1.1 "Segoe UI", ui-sans-serif, system-ui, sans-serif;
      letter-spacing: -0.02em;
    }
    .bubble.error .title { font: 700 16px/1.3 "Segoe UI", ui-sans-serif, system-ui, sans-serif; letter-spacing: 0; color: #fda4af; }
    .subtitle { font: 600 13px/1.35 "Segoe UI", ui-sans-serif, system-ui, sans-serif; color: #c4d4cb; }
    .stamp { font: 500 12px/1.35 "Segoe UI", ui-sans-serif, system-ui, sans-serif; color: #8ea398; }
    .bubble.warning .stamp { color: #fbbf24; }
    .details { display: grid; gap: 5px; margin-top: 6px; }
    .detail {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 2px 10px;
      padding: 6px 8px;
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.06);
    }
    .detail-label { font: 600 13px/1.3 "Segoe UI", ui-sans-serif, system-ui, sans-serif; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .detail-meta { grid-column: 1; font: 500 12px/1.3 "Segoe UI", ui-sans-serif, system-ui, sans-serif; color: #8ea398; }
    .detail-value { grid-row: 1 / span 2; grid-column: 2; align-self: center; font: 700 15px/1.2 "Segoe UI", ui-sans-serif, system-ui, sans-serif; }
    .detail-more { text-align: center; font: 500 12px/1.3 "Segoe UI", ui-sans-serif, system-ui, sans-serif; color: #8ea398; }
    .progress {
      position: absolute;
      left: 12px;
      right: 12px;
      bottom: 5px;
      height: 2px;
      border-radius: 2px;
      background: #3ddc8a;
      transform-origin: left;
      animation: to-nis-countdown ${countdownFor(bubble)}ms linear forwards;
    }
    .bubble.warning .progress { background: #fbbf24; }
    .bubble.error .progress { background: #fb7185; }
    .bubble.paused .progress { animation-play-state: paused; }
    @keyframes to-nis-countdown { from { transform: scaleX(1); } to { transform: scaleX(0); } }
    @media (prefers-reduced-motion: reduce) { .progress { animation: none; display: none; } }
  `;

  const layer = document.createElement("div");
  layer.className = `layer ${kind}`;
  const underlineLayer = document.createElement("div");
  layer.append(underlineLayer);

  const items = marks.map((mark) => {
    let chipElement = null;
    if (mark.chip) {
      chipElement = document.createElement("button");
      chipElement.type = "button";
      chipElement.className = `chip${mark.result.rateInfo.cacheStatus === "stale-fallback" ? " warn" : ""}`;
      chipElement.textContent = formatResult(mark.result);
      chipElement.title = `${rateLine(mark.result)} · ${buildTimestampText(mark.result.rateInfo)} (click to copy)`;
      chipElement.addEventListener("click", () => {
        copyToClipboard(mark.result.convertedAmount.toFixed(2), () => {
          chipElement.textContent = "Copied";
          setTimeout(() => { chipElement.textContent = formatResult(mark.result); }, 1200);
        });
      });
      layer.append(chipElement);
    }
    return { range: mark.range, chipElement };
  });

  let bubbleElement = null;
  let arrowElement = null;
  let stampElement = null;
  const staticAnchor = fallbackAnchor();

  if (bubble) {
    bubbleElement = document.createElement("div");
    bubbleElement.className = `bubble ${kind}`;
    bubbleElement.setAttribute("role", "status");
    bubbleElement.setAttribute("aria-live", "polite");

    arrowElement = document.createElement("div");
    arrowElement.className = "arrow down";

    const titleElement = document.createElement("div");
    titleElement.className = "title";
    titleElement.textContent = bubble.title;

    const subtitleElement = document.createElement("div");
    subtitleElement.className = "subtitle";
    subtitleElement.textContent = bubble.subtitle;

    stampElement = document.createElement("div");
    stampElement.className = "stamp";
    stampElement.textContent = bubble.stamp;

    bubbleElement.append(arrowElement, titleElement, subtitleElement, stampElement);

    if (bubble.details?.length) {
      const detailsWrap = document.createElement("div");
      detailsWrap.className = "details";

      for (const item of bubble.details.slice(0, MAX_DETAILS)) {
        const detail = document.createElement("div");
        detail.className = "detail";

        const label = document.createElement("div");
        label.className = "detail-label";
        label.textContent = item.label;

        const meta = document.createElement("div");
        meta.className = "detail-meta";
        meta.textContent = item.meta;

        const value = document.createElement("div");
        value.className = "detail-value";
        value.textContent = item.value;

        detail.append(label, meta, value);
        detailsWrap.append(detail);
      }

      if (bubble.details.length > MAX_DETAILS) {
        const more = document.createElement("div");
        more.className = "detail-more";
        more.textContent = `+${bubble.details.length - MAX_DETAILS} more not shown`;
        detailsWrap.append(more);
      }

      bubbleElement.append(detailsWrap);
    }

    const progress = document.createElement("div");
    progress.className = "progress";
    progress.addEventListener("animationend", destroy);
    bubbleElement.append(progress);

    if (bubble.copyText) {
      const originalStamp = bubble.stamp;
      bubbleElement.title = "Click to copy the amount · drag to move it around the price";
      bubbleElement.addEventListener("click", () => {
        if (suppressClick) {
          return;
        }

        copyToClipboard(bubble.copyText, () => {
          stampElement.textContent = `Copied ${bubble.copyText}`;
          setTimeout(() => { stampElement.textContent = originalStamp; }, 1400);
        });
      });
    }

    bubbleElement.addEventListener("mouseenter", () => bubbleElement.classList.add("paused"));
    bubbleElement.addEventListener("mouseleave", () => {
      if (!drag) {
        bubbleElement.classList.remove("paused");
      }
    });
    bubbleElement.addEventListener("pointerdown", startDrag);
    bubbleElement.addEventListener("pointermove", moveDrag);
    bubbleElement.addEventListener("pointerup", endDrag);
    bubbleElement.addEventListener("pointercancel", endDrag);
    layer.append(bubbleElement);
  }

  shadow.append(style, layer);
  document.documentElement.appendChild(host);

  let dismissed = false;
  let frame = 0;
  let drag = null;
  let suppressClick = false;
  const chipOnlyTimer = bubble ? null : setTimeout(destroy, CHIP_LIFETIME_MS);
  // A bubble pinned to fixed coordinates would drift away from the page on
  // scroll, so it is dismissed instead of repositioned.
  const dismissOnScroll = Boolean(bubble) && !items.length;

  function layout() {
    underlineLayer.textContent = "";

    for (const item of items) {
      const rects = [...item.range.getClientRects()].filter((rect) => rect.width > 0 && rect.height > 0);

      for (const rect of rects) {
        const underline = document.createElement("div");
        underline.className = "underline";
        underline.style.left = `${rect.left}px`;
        underline.style.top = `${rect.bottom - 1}px`;
        underline.style.width = `${rect.width}px`;
        underlineLayer.append(underline);
      }

      if (item.chipElement) {
        const last = rects[rects.length - 1];
        item.chipElement.hidden = !last;
        if (last) {
          const chipWidth = item.chipElement.offsetWidth;
          const chipHeight = item.chipElement.offsetHeight;
          const fitsRight = last.right + 4 + chipWidth <= window.innerWidth - 8;
          item.chipElement.style.left = `${fitsRight ? last.right + 4 : Math.max(8, window.innerWidth - 8 - chipWidth)}px`;
          item.chipElement.style.top = `${fitsRight ? last.top + (last.height - chipHeight) / 2 : last.bottom + 3}px`;
        }
      }
    }

    if (bubbleElement) {
      placeBubble();
    }
  }

  function currentAnchor() {
    return (anchorFn && anchorFn()) || staticAnchor;
  }

  // Puts the bubble on the chosen side of the price, flipping to the opposite
  // side when the window has no room.
  function placeBubble() {
    if (drag?.moved) {
      return;
    }

    const margin = 8;
    const gap = 12;
    const anchor = currentAnchor();
    const width = bubbleElement.offsetWidth;
    const height = bubbleElement.offsetHeight;
    const centerX = anchor.left + (anchor.right - anchor.left) / 2;
    const centerY = anchor.top + (anchor.bottom - anchor.top) / 2;
    const room = {
      top: anchor.top - gap - height >= margin,
      bottom: anchor.bottom + gap + height <= window.innerHeight - margin,
      left: anchor.left - gap - width >= margin,
      right: anchor.right + gap + width <= window.innerWidth - margin
    };
    const opposite = { top: "bottom", bottom: "top", left: "right", right: "left" };
    const side = !room[bubbleSide] && room[opposite[bubbleSide]] ? opposite[bubbleSide] : bubbleSide;

    let left;
    let top;
    if (side === "top" || side === "bottom") {
      left = centerX - width / 2;
      top = side === "top" ? anchor.top - gap - height : anchor.bottom + gap;
    } else {
      left = side === "left" ? anchor.left - gap - width : anchor.right + gap;
      top = centerY - height / 2;
    }

    left = clamp(left, margin, Math.max(margin, window.innerWidth - width - margin));
    top = clamp(top, margin, Math.max(margin, window.innerHeight - height - margin));
    bubbleElement.style.left = `${left}px`;
    bubbleElement.style.top = `${top}px`;

    if (side === "top" || side === "bottom") {
      arrowElement.className = `arrow ${side === "top" ? "down" : "up"}`;
      arrowElement.style.top = "";
      arrowElement.style.left = `${clamp(centerX - left - 5, 12, Math.max(12, width - 22))}px`;
    } else {
      arrowElement.className = `arrow ${side === "left" ? "right" : "left"}`;
      arrowElement.style.left = "";
      arrowElement.style.top = `${clamp(centerY - top - 5, 12, Math.max(12, height - 22))}px`;
    }
  }

  function startDrag(event) {
    if (event.button !== 0) {
      return;
    }

    const rect = bubbleElement.getBoundingClientRect();
    drag = {
      startX: event.clientX,
      startY: event.clientY,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      moved: false
    };
    bubbleElement.setPointerCapture(event.pointerId);
  }

  function moveDrag(event) {
    if (!drag) {
      return;
    }

    if (!drag.moved) {
      if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 4) {
        return;
      }

      drag.moved = true;
      bubbleElement.classList.add("dragging", "paused");
    }

    bubbleElement.style.left = `${clamp(event.clientX - drag.offsetX, 8, window.innerWidth - bubbleElement.offsetWidth - 8)}px`;
    bubbleElement.style.top = `${clamp(event.clientY - drag.offsetY, 8, window.innerHeight - bubbleElement.offsetHeight - 8)}px`;
  }

  // On release, snap to whichever side of the price the bubble was dropped on
  // and remember it for next time.
  function endDrag(event) {
    if (!drag) {
      return;
    }

    const wasMoved = drag.moved;
    drag = null;
    bubbleElement.classList.remove("dragging");

    if (!wasMoved) {
      return;
    }

    const anchor = currentAnchor();
    const bubbleRect = bubbleElement.getBoundingClientRect();
    const dx = bubbleRect.left + bubbleRect.width / 2 - (anchor.left + anchor.right) / 2;
    const dy = bubbleRect.top + bubbleRect.height / 2 - (anchor.top + anchor.bottom) / 2;
    const horizontalReach = (bubbleRect.width + (anchor.right - anchor.left)) / 2;
    const verticalReach = (bubbleRect.height + (anchor.bottom - anchor.top)) / 2;

    bubbleSide = Math.abs(dx) / horizontalReach > Math.abs(dy) / verticalReach
      ? (dx < 0 ? "left" : "right")
      : (dy < 0 ? "top" : "bottom");
    saveBubbleSide();

    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 0);
    if (!bubbleElement.matches(":hover")) {
      bubbleElement.classList.remove("paused");
    }
    placeBubble();
  }

  function scheduleLayout() {
    if (dismissOnScroll) {
      destroy();
      return;
    }
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(layout);
  }

  function onKeyDown(event) {
    if (event.key === "Escape") {
      destroy();
    }
  }

  function onPointerDown(event) {
    if (!event.composedPath().includes(host)) {
      destroy();
    }
  }

  function destroy() {
    if (dismissed) {
      return;
    }

    dismissed = true;
    clearTimeout(chipOnlyTimer);
    cancelAnimationFrame(frame);
    document.removeEventListener("keydown", onKeyDown, true);
    document.removeEventListener("pointerdown", onPointerDown, true);
    window.removeEventListener("scroll", scheduleLayout, true);
    window.removeEventListener("resize", scheduleLayout);
    host.remove();
    if (activeTooltip?.destroy === destroy) {
      activeTooltip = null;
    }
  }

  document.addEventListener("keydown", onKeyDown, true);
  document.addEventListener("pointerdown", onPointerDown, true);
  window.addEventListener("scroll", scheduleLayout, true);
  window.addEventListener("resize", scheduleLayout);
  layout();

  return { destroy };
}

function saveBubbleSide() {
  try {
    chrome.storage.local.set({ bubbleSide }).catch(() => {});
  } catch {
    // Extension context can be invalidated after a reload; ignore.
  }
}

function countdownFor(bubble) {
  const rows = bubble?.details?.length || 0;
  return TOOLTIP_TOKENS.baseCountdownMs + TOOLTIP_TOKENS.perDetailMs * Math.min(rows, MAX_DETAILS);
}

// Where a bubble goes when the price itself couldn't be located on the page.
function fallbackAnchor() {
  if (lastContext.selectionRect) {
    return lastContext.selectionRect;
  }

  if (lastContext.x || lastContext.y) {
    return { left: lastContext.x, right: lastContext.x, top: lastContext.y, bottom: lastContext.y };
  }

  const centerX = window.innerWidth / 2;
  return { left: centerX, right: centerX, top: 96, bottom: 96 };
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

function formatMoney(amount, currency) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 2
  }).format(amount);
}

function formatResult(result) {
  return formatMoney(result.convertedAmount, result.targetCurrency);
}

function rateLine(result) {
  const target = result.targetCurrency === "ILS" ? "NIS" : result.targetCurrency;
  return `1 ${result.currencyCode} = ${formatRate(result.rateInfo.rate)} ${target}`;
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
})();
