// Listen for messages from background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "SHOW_CONVERSION") {
    showTooltip(message.data);
  }
});

// Global reference to current tooltip for cleanup
let currentTooltip = null;
let dismissTimeout = null;

// Show tooltip with conversion result
function showTooltip(data) {
  // Remove existing tooltip if any
  if (currentTooltip) {
    dismissTooltip(true); // immediate dismissal
  }

  // Get selection position
  const selection = window.getSelection();
  if (!selection.rangeCount) {
    return;
  }

  const range = selection.getRangeAt(0);
  const rect = range.getBoundingClientRect();

  // Create tooltip container
  const container = document.createElement("div");
  container.id = "nis-converter-tooltip-container";

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
      border-left: 4px solid ${data.success ? "#4CAF50" : "#f44336"};
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
    }

    .nis-tooltip-timestamp {
      font-size: 11px;
      color: #999;
      margin-top: 6px;
      font-style: italic;
      line-height: 1.4;
    }
  `;

  shadow.appendChild(style);
  shadow.appendChild(tooltip);

  // Position tooltip BEFORE adding to DOM
  positionTooltip(tooltip, rect);

  // Add to page
  document.body.appendChild(container);

  // Trigger fade-in animation
  requestAnimationFrame(() => {
    tooltip.classList.add("show");
  });

  // Store reference
  currentTooltip = container;

  // Auto-dismiss after 5 seconds
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

// Dismiss tooltip with fade-out animation
function dismissTooltip(immediate = false) {
  if (!currentTooltip) return;

  if (dismissTimeout) {
    clearTimeout(dismissTimeout);
    dismissTimeout = null;
  }

  if (immediate) {
    // Remove immediately without animation
    currentTooltip.remove();
    currentTooltip = null;
  } else {
    // Fade out then remove
    const tooltip = currentTooltip.shadowRoot.querySelector(".nis-tooltip");
    tooltip.classList.remove("show");
    tooltip.classList.add("fade-out");

    setTimeout(() => {
      if (currentTooltip) {
        currentTooltip.remove();
        currentTooltip = null;
      }
    }, 300); // match CSS transition duration
  }
}
