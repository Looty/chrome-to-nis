// Cache for exchange rates
const rateCache = {
  data: {},
  timestamp: {}
};

const CACHE_DURATION = 60 * 60 * 1000; // 1 hour in milliseconds

// Track which tabs have content script loaded
const loadedTabs = new Set();

// Create context menu when extension is installed
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "convertToNIS",
    title: "To NIS",
    contexts: ["all"]
  });
});

// Handle context menu click
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== "convertToNIS") return;
  try {
    if (info.selectionText) {
      await convertToNIS(info.selectionText.trim(), tab);
    } else {
      // No selection — extract prices from the right-clicked element
      let response;
      try {
        response = await chrome.tabs.sendMessage(tab.id, { type: "GET_ELEMENT_TEXT" });
      } catch {
        // Content script not loaded, inject then retry
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
        await new Promise(resolve => setTimeout(resolve, 100));
        response = await chrome.tabs.sendMessage(tab.id, { type: "GET_ELEMENT_TEXT" }).catch(() => null);
      }
      if (response?.text) {
        await convertAllToNIS(response.text, response.pos, tab);
      }
    }
  } catch (error) {
    // Silently catch any errors to prevent them from showing in extension error log
  }
});

// Parse currency from selected text
function parseCurrency(text) {
  // Remove commas and spaces for easier parsing
  const cleanText = text.replace(/,/g, '').trim();

  // Currency symbols and their codes
  const currencyMap = {
    '$': 'USD',
    '€': 'EUR',
    '£': 'GBP',
    '¥': 'JPY',
    '₹': 'INR',
    '₽': 'RUB',
    'CA$': 'CAD',
    'A$': 'AUD',
    'C$': 'CAD',
    'AU$': 'AUD',
    'NZ$': 'NZD',
    'HK$': 'HKD',
    'S$': 'SGD',
    'kr': 'SEK',
    'CHF': 'CHF',
    '₪': 'ILS'
  };

  // Try to match: symbol + number (e.g., "$28", "€50")
  let match = cleanText.match(/([€£¥₹₽₪\$])[\s]*([\d.]+)/);
  if (match) {
    const symbol = match[1];
    const amount = parseFloat(match[2]);
    const currency = currencyMap[symbol] || 'USD';
    return { amount, currency };
  }

  // Try to match: number + symbol (e.g., "28$", "50€")
  match = cleanText.match(/([\d.]+)[\s]*([€£¥₹₽₪\$])/);
  if (match) {
    const amount = parseFloat(match[1]);
    const symbol = match[2];
    const currency = currencyMap[symbol] || 'USD';
    return { amount, currency };
  }

  // Try to match multi-char symbols (e.g., "CA$28", "AU$50")
  match = cleanText.match(/(CA\$|A\$|C\$|AU\$|NZ\$|HK\$|S\$)[\s]*([\d.]+)/);
  if (match) {
    const symbol = match[1];
    const amount = parseFloat(match[2]);
    const currency = currencyMap[symbol];
    return { amount, currency };
  }

  // Try to match: number + currency code (e.g., "28 USD", "50EUR")
  match = cleanText.match(/([\d.]+)[\s]*([A-Z]{3})/);
  if (match) {
    const amount = parseFloat(match[1]);
    const currency = match[2];
    return { amount, currency };
  }

  // Try to match: currency code + number (e.g., "USD 28", "EUR50")
  match = cleanText.match(/([A-Z]{3})[\s]*([\d.]+)/);
  if (match) {
    const currency = match[1];
    const amount = parseFloat(match[2]);
    return { amount, currency };
  }

  return null;
}

// Format a number with thousands separators, up to 2 decimal places
function formatNum(n) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

// Find ALL currency amounts in a block of text
function parseAllCurrencies(text) {
  const cleanText = text.replace(/,/g, '');
  const currencyMap = {
    '$': 'USD', '€': 'EUR', '£': 'GBP', '¥': 'JPY', '₹': 'INR',
    '₽': 'RUB', '₪': 'ILS', 'CA$': 'CAD', 'A$': 'AUD', 'C$': 'CAD',
    'AU$': 'AUD', 'NZ$': 'NZD', 'HK$': 'HKD', 'S$': 'SGD'
  };
  const results = [];
  const seen = new Set();

  const add = (amount, currency) => {
    const key = `${amount}${currency}`;
    if (!seen.has(key) && !isNaN(amount) && amount > 0) {
      seen.add(key);
      results.push({ amount, currency });
    }
  };

  for (const m of cleanText.matchAll(/(CA\$|A\$|C\$|AU\$|NZ\$|HK\$|S\$)[\s]*([\d.]+)/g))
    add(parseFloat(m[2]), currencyMap[m[1]]);
  for (const m of cleanText.matchAll(/([€£¥₹₽₪$])[\s]*([\d.]+)/g))
    add(parseFloat(m[2]), currencyMap[m[1]] || 'USD');
  for (const m of cleanText.matchAll(/([\d.]+)[\s]*([€£¥₹₽₪$])/g))
    add(parseFloat(m[1]), currencyMap[m[2]] || 'USD');

  // Remove DOM-split artefacts produced by Amazon-style price markup:
  //   "$56.99" renders as separate spans → innerText yields both "56" (whole part)
  //   and "5699" (whole+fraction concatenated). Filter those out when a decimal
  //   version of the same price is already present.
  return results.filter(({ amount, currency }) => {
    if (amount % 1 !== 0) return true; // keep all non-integers as-is
    const isWholePart  = results.some(o => o.currency === currency && o.amount !== amount
      && o.amount % 1 !== 0 && Math.floor(o.amount) === amount);
    const isConcatCents = results.some(o => o.currency === currency && o.amount !== amount
      && Math.round(o.amount * 100) === amount);
    return !isWholePart && !isConcatCents;
  });
}

// Convert all prices found in an element's text
async function convertAllToNIS(text, pos, tab) {
  const prices = parseAllCurrencies(text);

  if (prices.length === 0) {
    await sendToContentScript(tab, 'No prices found', 'Could not detect any currency in this element', false, '', pos);
    return;
  }

  if (prices.length === 1) {
    await convertToNIS(`${prices[0].currency}${prices[0].amount}`, tab, pos);
    return;
  }

  try {
    const lines = [];
    let rateInfo = '';
    for (const { amount, currency } of prices) {
      if (currency === 'ILS') {
        lines.push(`${amount} ₪ (already NIS)`);
        continue;
      }
      const rates = await getExchangeRate(currency);
      const rateToNIS = rates.ILS;
      const converted = (amount * rateToNIS).toFixed(2);
      lines.push(`${formatNum(amount)} ${currency}  →  ${formatNum(parseFloat(converted))} ₪`);
      if (!rateInfo) rateInfo = `Rate: 1 ${currency} = ${rateToNIS.toFixed(4)} ILS`;
    }
    const timestamp = getTimestampText(prices[0].currency);
    await sendToContentScript(tab, `${prices.length} prices`, lines.join('\n') + (rateInfo ? `\n${rateInfo}` : ''), true, timestamp, pos);
  } catch (error) {
    await sendToContentScript(tab, 'Error', `Failed to convert: ${error.message}`, false, '', pos);
  }
}

// Check if cached rate is still valid
function isCacheValid(currency) {
  if (!rateCache.data[currency] || !rateCache.timestamp[currency]) {
    return false;
  }
  const age = Date.now() - rateCache.timestamp[currency];
  return age < CACHE_DURATION;
}

// Get exchange rate (from cache or API)
async function getExchangeRate(currency) {
  // Check cache first
  if (isCacheValid(currency)) {
    return rateCache.data[currency];
  }

  // Fetch from API
  const apiUrl = `https://api.exchangerate-api.com/v4/latest/${currency}`;
  const response = await fetch(apiUrl);

  if (!response.ok) {
    throw new Error('Failed to fetch exchange rate');
  }

  const data = await response.json();

  // Cache the rates
  rateCache.data[currency] = data.rates;
  rateCache.timestamp[currency] = Date.now();

  return data.rates;
}

// Convert currency to NIS
async function convertToNIS(text, tab, pos = null) {
  try {
    const parsed = parseCurrency(text);

    if (!parsed) {
      await sendToContentScript(tab, 'Error', 'Could not detect currency. Try selecting text like "$28" or "50 EUR"', false, '', pos);
      return;
    }

    const { amount, currency } = parsed;

    // If already in ILS/NIS, no conversion needed
    if (currency === 'ILS' || currency === 'NIS') {
      await sendToContentScript(tab, 'Already in NIS', `${amount} ₪`, true, '', pos);
      return;
    }

    // Get exchange rate (cached or fresh)
    const rates = await getExchangeRate(currency);
    const rateToNIS = rates.ILS;

    if (!rateToNIS) {
      throw new Error('NIS rate not available');
    }

    const convertedAmount = (amount * rateToNIS).toFixed(2);
    const timestamp = getTimestampText(currency);

    await sendToContentScript(
      tab,
      `${formatNum(amount)} ${currency} = ${formatNum(parseFloat(convertedAmount))} ₪`,
      `Exchange rate: 1 ${currency} = ${rateToNIS.toFixed(4)} ILS`,
      true,
      timestamp,
      pos
    );

  } catch (error) {
    if (error.message !== 'Failed to fetch exchange rate') {
      console.error('Conversion error:', error);
    }
    await sendToContentScript(tab, 'Error', `Failed to convert: ${error.message}`, false, '', pos);
  }
}

// Get human-readable timestamp for when rate was last updated
function getTimestampText(currency) {
  if (!rateCache.timestamp[currency]) {
    return 'Rate updated just now';
  }

  const now = Date.now();
  const cacheTime = rateCache.timestamp[currency];
  const ageMinutes = Math.floor((now - cacheTime) / (1000 * 60));

  if (ageMinutes < 1) {
    return 'Rate updated just now';
  } else if (ageMinutes === 1) {
    return 'Rate updated 1 minute ago';
  } else if (ageMinutes < 60) {
    return `Rate updated ${ageMinutes} minutes ago`;
  } else {
    const ageHours = Math.floor(ageMinutes / 60);
    if (ageHours === 1) {
      return 'Rate updated 1 hour ago';
    } else {
      return `Rate updated ${ageHours} hours ago`;
    }
  }
}

// Send conversion result to content script
async function sendToContentScript(tab, title, message, success = true, timestamp = '', pos = null) {
  const messageData = {
    type: 'SHOW_CONVERSION',
    data: {
      title: title,
      subtitle: message,
      success: success,
      timestamp: timestamp,
      pos: pos
    }
  };

  // Wrap everything in try-catch to prevent any errors from bubbling up
  try {
    try {
      await chrome.tabs.sendMessage(tab.id, messageData);
      loadedTabs.add(tab.id);
    } catch (error) {
      // Content script not loaded yet, inject it first
      if (!loadedTabs.has(tab.id)) {
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content.js']
          });

          loadedTabs.add(tab.id);

          // Wait a bit for the script to initialize
          await new Promise(resolve => setTimeout(resolve, 100));

          // Try sending message again
          await chrome.tabs.sendMessage(tab.id, messageData);
        } catch (injectionError) {
          // Silently fail - likely a page that doesn't allow script injection
        }
      }
    }
  } catch (outerError) {
    // Catch any unexpected errors and silently ignore them
  }
}

// Clean up when tabs are closed
chrome.tabs.onRemoved.addListener((tabId) => {
  loadedTabs.delete(tabId);
});
