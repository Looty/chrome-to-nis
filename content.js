// Track right-click target for context menu conversions
let lastContextMenuText = null;
let lastContextMenuPos = null;

document.addEventListener('contextmenu', (e) => {
  if (e.target.id === 'nis-converter-tooltip-container') return;
  lastContextMenuText = e.target.innerText || '';
  lastContextMenuPos = { x: e.clientX, y: e.clientY };
});

// Listen for messages from background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "SHOW_CONVERSION") {
    showTooltip(message.data);
  } else if (message.type === "GET_ELEMENT_TEXT") {
    sendResponse({ text: lastContextMenuText, pos: lastContextMenuPos });
  }
  return true;
});

// Global reference to current tooltip for cleanup
let currentTooltip = null;
let dismissTimeout = null;
let timerStartTime = null;   // Date.now() when dismiss timer started
let remainingTime = null;    // ms remaining when drag begins
let dragStartTime = null;    // Date.now() when mousedown fires

// Show tooltip with conversion result
function showTooltip(data) {
  // Remove existing tooltip if any
  if (currentTooltip) {
    dismissTooltip(true); // immediate dismissal
  }

  // Get position: from right-click coord or selection
  let rect;
  if (data.pos) {
    rect = { top: data.pos.y, bottom: data.pos.y, left: data.pos.x, right: data.pos.x, width: 0 };
  } else {
    const selection = window.getSelection();
    if (!selection.rangeCount) return;
    rect = selection.getRangeAt(0).getBoundingClientRect();
  }

  // Create tooltip container
  const container = document.createElement("div");
  container.id = "nis-converter-tooltip-container";
  // Reset page-level zoom and font-size inheritance that can bleed into the shadow DOM
  container.style.cssText = "all: initial; zoom: 1; display: block;";

  // Use Shadow DOM for style isolation
  const shadow = container.attachShadow({ mode: "open" });

  // Create tooltip element
  const tooltip = document.createElement("div");
  tooltip.className = "nis-tooltip";

  // Create header container for title and close button
  const header = document.createElement("div");
  header.className = "nis-tooltip-header";

  // Add title
  const titleEl = document.createElement("div");
  titleEl.className = "nis-tooltip-title";
  titleEl.textContent = data.title;

  // Create close button with SVG icon
  const closeBtn = document.createElement("button");
  closeBtn.className = "nis-tooltip-close";

  // Create SVG icon using DOM methods
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", "20");
  svg.setAttribute("height", "20");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");

  const line1 = document.createElementNS("http://www.w3.org/2000/svg", "line");
  line1.setAttribute("x1", "18");
  line1.setAttribute("y1", "6");
  line1.setAttribute("x2", "6");
  line1.setAttribute("y2", "18");

  const line2 = document.createElementNS("http://www.w3.org/2000/svg", "line");
  line2.setAttribute("x1", "6");
  line2.setAttribute("y1", "6");
  line2.setAttribute("x2", "18");
  line2.setAttribute("y2", "18");

  svg.appendChild(line1);
  svg.appendChild(line2);
  closeBtn.appendChild(svg);
  closeBtn.addEventListener("click", () => dismissTooltip());

  header.appendChild(titleEl);
  header.appendChild(closeBtn);

  // Add content
  const subtitleEl = document.createElement("div");
  subtitleEl.className = "nis-tooltip-subtitle";
  subtitleEl.textContent = data.subtitle;

  const timestampEl = document.createElement("div");
  timestampEl.className = "nis-tooltip-timestamp";
  timestampEl.textContent = data.timestamp || "Rate updated just now";

  tooltip.appendChild(header);
  tooltip.appendChild(subtitleEl);
  tooltip.appendChild(timestampEl);

  // Add styles
  const style = document.createElement("style");
  style.textContent = `
    .nis-tooltip {
      position: fixed;
      background: white;
      border: 1px solid #e0e0e0;
      border-left: 4px solid transparent;
      border-radius: 8px;
      padding: 12px 16px;
      max-width: 300px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
      z-index: 2147483647;
      opacity: 0;
      transition: opacity 0.2s ease-in;
      pointer-events: auto;
    }

    .nis-tooltip.show {
      opacity: 1;
    }

    .nis-tooltip.fade-out {
      opacity: 0;
      transition: opacity 0.3s ease-out;
    }

    .nis-tooltip-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
    }

    .nis-tooltip-title {
      font-size: 16px;
      font-weight: 600;
      color: ${data.success ? "#333" : "#d32f2f"};
      line-height: 1.4;
      flex: 1;
    }

    .nis-tooltip-close {
      background: none;
      border: none;
      color: #f44336;
      cursor: pointer;
      padding: 4px;
      width: 28px;
      height: 28px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 4px;
      flex-shrink: 0;
      transition: all 0.2s ease;
    }

    .nis-tooltip-close:hover {
      color: #d32f2f;
      box-shadow: inset 0 0 0 2px #f44336;
    }

    .nis-tooltip-subtitle {
      font-size: 13px;
      color: #666;
      line-height: 1.4;
      margin-top: 8px;
      white-space: pre-line;
    }

    .nis-tooltip-timestamp {
      font-size: 11px;
      color: #999;
      margin-top: 6px;
      font-style: italic;
      line-height: 1.4;
    }

    .nis-tooltip::before {
      content: '';
      position: absolute;
      left: -4px;
      top: 0;
      width: 4px;
      height: 100%;
      background: ${data.success ? "#4CAF50" : "#f44336"};
      border-radius: 8px 0 0 8px;
      animation: nis-sidebar-drain 5s linear forwards;
    }

    @keyframes nis-sidebar-drain {
      from { clip-path: inset(0 0 0 0 round 8px 0 0 8px); }
      to   { clip-path: inset(100% 0 0 0 round 8px 0 0 8px); }
    }

    .nis-tooltip.is-dragging::before {
      animation-play-state: paused;
    }

    .nis-tooltip {
      cursor: grab;
    }

    .nis-tooltip.is-dragging {
      cursor: grabbing;
    }
  `;

  shadow.appendChild(style);
  shadow.appendChild(tooltip);

  // Position tooltip BEFORE adding to DOM
  positionTooltip(tooltip, rect);

  // Add to page
  document.body.appendChild(container);

  // Trigger fade-in animation and wire up drag
  requestAnimationFrame(() => {
    tooltip.classList.add("show");
    addDragBehavior(tooltip);
  });

  // Store reference
  currentTooltip = container;

  // Auto-dismiss after 5 seconds
  timerStartTime = Date.now();
  dismissTimeout = setTimeout(() => {
    dismissTooltip();
  }, 5000);
}

// Position tooltip near selection
function positionTooltip(tooltip, selectionRect) {
  const tooltipHeight = 70; // approximate height
  const tooltipWidth = 300; // max-width
  const offset = 10; // gap between selection and tooltip

  // Calculate initial position (above and centered)
  let top = selectionRect.top - tooltipHeight - offset;
  let left = selectionRect.left + selectionRect.width / 2 - tooltipWidth / 2;

  // Adjust if would overflow top of viewport
  if (top < 10) {
    // Position below selection instead
    top = selectionRect.bottom + offset;
  }

  // Adjust if would overflow left edge
  if (left < 10) {
    left = 10;
  }

  // Adjust if would overflow right edge
  if (left + tooltipWidth > window.innerWidth - 10) {
    left = window.innerWidth - tooltipWidth - 10;
  }

  // Apply position to the tooltip itself (which uses position: fixed)
  tooltip.style.top = `${top}px`;
  tooltip.style.left = `${left}px`;
}

// Add drag-to-move and freeze-timer-on-hold behavior to a tooltip element
function addDragBehavior(tooltip) {
  const closeBtn = tooltip.querySelector(".nis-tooltip-close");

  let isDragging = false;
  let mouseOffsetX = 0;
  let mouseOffsetY = 0;

  function onMouseDown(e) {
    if (e.target === closeBtn || closeBtn.contains(e.target)) return;
    if (e.button !== 0) return;
    isDragging = true;

    const rect = tooltip.getBoundingClientRect();
    mouseOffsetX = e.clientX - rect.left;
    mouseOffsetY = e.clientY - rect.top;

    // Freeze timer
    dragStartTime = Date.now();
    const elapsed = dragStartTime - timerStartTime;
    remainingTime = Math.max(0, 5000 - elapsed);
    if (dismissTimeout) { clearTimeout(dismissTimeout); dismissTimeout = null; }
    tooltip.classList.add("is-dragging");
    e.preventDefault();
  }

  function onMouseMove(e) {
    if (!isDragging) return;
    const rect = tooltip.getBoundingClientRect();
    const newLeft = Math.max(0, Math.min(e.clientX - mouseOffsetX, window.innerWidth - rect.width));
    const newTop  = Math.max(0, Math.min(e.clientY - mouseOffsetY, window.innerHeight - rect.height));
    tooltip.style.left = `${newLeft}px`;
    tooltip.style.top  = `${newTop}px`;
  }

  function onMouseUp() {
    if (!isDragging) return;
    isDragging = false;
    tooltip.classList.remove("is-dragging");

    // Resume timer
    if (remainingTime !== null && remainingTime > 0) {
      timerStartTime = Date.now() - (5000 - remainingTime);
      dismissTimeout = setTimeout(() => dismissTooltip(), remainingTime);
    } else if (remainingTime !== null) {
      dismissTooltip();
    }
    dragStartTime = null;
  }

  tooltip.addEventListener("mousedown", onMouseDown);
  document.addEventListener("mousemove", onMouseMove);
  document.addEventListener("mouseup", onMouseUp);

  tooltip._removeDragListeners = () => {
    document.removeEventListener("mousemove", onMouseMove);
    document.removeEventListener("mouseup", onMouseUp);
  };
}

// Dismiss tooltip with fade-out animation
function dismissTooltip(immediate = false) {
  if (!currentTooltip) return;

  if (dismissTimeout) {
    clearTimeout(dismissTimeout);
    dismissTimeout = null;
  }

  if (immediate) {
    // Remove immediately without animation
    const tooltipEl = currentTooltip.shadowRoot.querySelector(".nis-tooltip");
    if (tooltipEl && tooltipEl._removeDragListeners) tooltipEl._removeDragListeners();
    currentTooltip.remove();
    currentTooltip = null;
    timerStartTime = null;
    remainingTime = null;
    dragStartTime = null;
  } else {
    // Fade out then remove
    const tooltip = currentTooltip.shadowRoot.querySelector(".nis-tooltip");
    if (tooltip && tooltip._removeDragListeners) tooltip._removeDragListeners();
    tooltip.classList.remove("show");
    tooltip.classList.add("fade-out");

    setTimeout(() => {
      if (currentTooltip) {
        currentTooltip.remove();
        currentTooltip = null;
        timerStartTime = null;
        remainingTime = null;
        dragStartTime = null;
      }
    }, 300); // match CSS transition duration
  }
}
