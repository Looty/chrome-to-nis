const MENU_ID = "to-nis";
const COMMAND_ID = "convert-selection";
const CACHE_TTL_MS = 60 * 60 * 1000;
const API_URL = "https://open.er-api.com/v6/latest/ILS";
const STORAGE_KEY = "rateCacheV2";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: "To NIS",
      contexts: ["selection", "page", "link", "image", "video", "audio"]
    });
  });

  injectIntoExistingTabs();
});

// Tabs opened before install/reload never got the static content script;
// without it the first right-click has no captured context to convert.
async function injectIntoExistingTabs() {
  const tabs = await chrome.tabs.query({ url: ["http://*/*", "https://*/*"] });
  await Promise.allSettled(
    tabs.map((tab) =>
      chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        files: ["content.js"]
      })
    )
  );
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID || !tab?.id) {
    return;
  }

  const mode = info.selectionText?.trim() ? "selection" : "element";
  const payload = {
    type: "TO_NIS_RUN",
    mode,
    selectionText: info.selectionText || ""
  };

  try {
    await sendToContentScript(tab.id, info.frameId ?? 0, payload);
  } catch (error) {
    console.error("Failed to send TO_NIS_RUN message", error);
  }
});

// The right-click happened in one specific frame (it may be an iframe), and
// only that frame's content script holds the captured context.
chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== COMMAND_ID || !tab?.id) {
    return;
  }

  try {
    const frameId = await findSelectionFrame(tab.id);
    await sendToContentScript(tab.id, frameId, {
      type: "TO_NIS_RUN",
      mode: "selection",
      source: "shortcut",
      selectionText: ""
    });
  } catch (error) {
    console.error("Failed to run To NIS shortcut", error);
  }
});

// The selection may live in an iframe; ask every frame and use the one that has text.
async function findSelectionFrame(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => Boolean(window.getSelection()?.toString().trim())
    });
    return results.find((entry) => entry.result)?.frameId ?? 0;
  } catch {
    return 0;
  }
}

async function sendToContentScript(tabId, frameId, payload) {
  try {
    await chrome.tabs.sendMessage(tabId, payload, { frameId });
    return;
  } catch (error) {
    if (!isMissingReceiverError(error)) {
      throw error;
    }
  }

  await chrome.scripting.executeScript({
    target: { tabId, frameIds: [frameId] },
    files: ["content.js"]
  });

  await chrome.tabs.sendMessage(tabId, payload, { frameId });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "TO_NIS_CONVERT") {
    return undefined;
  }

  (async () => {
    try {
      const results = await convertPrices(message.prices || []);
      sendResponse({ ok: true, results });
    } catch (error) {
      console.error("Conversion failed", error);
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : "Unknown conversion error."
      });
    }
  })();

  return true;
});

async function convertPrices(prices) {
  const uniqueCurrencies = [...new Set(prices.map((price) => price.currencyCode))];
  const table = await getRateTable(uniqueCurrencies);

  return prices.map((price) => {
    const rateInfo = buildRateInfo(price.currencyCode, table);
    return {
      ...price,
      convertedAmount: roundMoney(price.amount * rateInfo.rate),
      rateInfo
    };
  });
}

// One request to /latest/ILS returns units-per-ILS for every currency
// (inverted at lookup time), so a single cached table serves all conversions.
async function getRateTable(neededCurrencies) {
  const now = Date.now();
  const cached = await loadCache();
  const cacheCovers = cached &&
    neededCurrencies.every((code) => code === "ILS" || typeof cached.rates[code] === "number");

  if (cacheCovers && now - cached.fetchedAt < CACHE_TTL_MS) {
    return { ...cached, cacheStatus: "cached" };
  }

  try {
    const response = await fetch(API_URL);
    if (!response.ok) {
      throw new Error(`Rate request failed with ${response.status}`);
    }

    const data = await response.json();
    if (!data?.rates || typeof data.rates !== "object") {
      throw new Error("Rate table missing in API response");
    }

    const table = { rates: data.rates, fetchedAt: now };
    await chrome.storage.local.set({ [STORAGE_KEY]: table });
    return { ...table, cacheStatus: "fresh" };
  } catch (error) {
    if (cacheCovers) {
      return { ...cached, cacheStatus: "stale-fallback" };
    }

    throw error;
  }
}

function buildRateInfo(currencyCode, table) {
  if (currencyCode === "ILS") {
    return {
      currencyCode,
      rate: 1,
      fetchedAt: Date.now(),
      staleMs: 0,
      cacheStatus: "fresh"
    };
  }

  const unitsPerIls = table.rates[currencyCode];
  if (typeof unitsPerIls !== "number" || unitsPerIls <= 0) {
    throw new Error(`ILS rate missing for ${currencyCode}`);
  }

  return {
    currencyCode,
    rate: 1 / unitsPerIls,
    fetchedAt: table.fetchedAt,
    staleMs: Date.now() - table.fetchedAt,
    cacheStatus: table.cacheStatus
  };
}

async function loadCache() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const cached = stored[STORAGE_KEY];
  return cached && cached.rates && typeof cached.fetchedAt === "number" ? cached : null;
}

function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function isMissingReceiverError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("Receiving end does not exist");
}
