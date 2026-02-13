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
    contexts: ["selection"]
  });
});

// Handle context menu click
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "convertToNIS") {
    const selectedText = info.selectionText.trim();
    try {
      await convertToNIS(selectedText, tab);
    } catch (error) {
      // Silently catch any errors to prevent them from showing in extension error log
    }
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
async function convertToNIS(text, tab) {
  try {
    const parsed = parseCurrency(text);

    if (!parsed) {
      await sendToContentScript(tab, 'Error', 'Could not detect currency. Try selecting text like "$28" or "50 EUR"', false);
      return;
    }

    const { amount, currency } = parsed;

    // If already in ILS/NIS, no conversion needed
    if (currency === 'ILS' || currency === 'NIS') {
      await sendToContentScript(tab, 'Already in NIS', `${amount} ₪`, true);
      return;
    }

    // Get exchange rate (cached or fresh)
    const rates = await getExchangeRate(currency);
    const rateToNIS = rates.ILS;

    if (!rateToNIS) {
      throw new Error('NIS rate not available');
    }

    const convertedAmount = (amount * rateToNIS).toFixed(2);

    // Calculate when rate was last updated
    const timestamp = getTimestampText(currency);

    // Show result
    await sendToContentScript(
      tab,
      `${amount} ${currency} = ${convertedAmount} ₪`,
      `Exchange rate: 1 ${currency} = ${rateToNIS.toFixed(4)} ILS`,
      true,
      timestamp
    );

  } catch (error) {
    // Only log actual conversion errors, not display errors
    if (error.message !== 'Failed to fetch exchange rate') {
      console.error('Conversion error:', error);
    }
    await sendToContentScript(tab, 'Error', `Failed to convert: ${error.message}`, false);
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
async function sendToContentScript(tab, title, message, success = true, timestamp = '') {
  const messageData = {
    type: 'SHOW_CONVERSION',
    data: {
      title: title,
      subtitle: message,
      success: success,
      timestamp: timestamp
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
