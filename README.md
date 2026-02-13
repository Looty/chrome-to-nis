# Currency to NIS Chrome Extension

Convert any currency to Israeli New Shekel (₪) with a simple right-click!

## Features

- 🚀 **Quick conversion**: Right-click any selected currency text
- 💡 **Floating tooltip**: Result appears instantly right next to the selected text - no need to look away!
- ⚡ **Smart caching**: Caches exchange rates for 1 hour - repeat conversions are instant!
- 💱 **Multiple formats supported**: $28, 28$, 28 USD, USD 28, €50, £100, etc.
- 🌍 **Many currencies**: USD, EUR, GBP, JPY, CAD, AUD, and more
- 🎨 **Clean design**: Minimal tooltip with Shadow DOM - works on any website without conflicts
- 📡 **Real-time rates**: Uses live exchange rates via ExchangeRate-API

## Installation Instructions

### Step 1: Download the Extension

The extension files are in this folder:
```
chrome-to-nis/
├── manifest.json
├── background.js
├── icon16.png
├── icon48.png
└── icon128.png
```

### Step 2: Load Extension in Chrome

1. **Open Chrome Extensions page**
   - Click the three dots menu (⋮) in the top-right corner
   - Go to: **More tools** → **Extensions**
   - Or simply type in address bar: `chrome://extensions/`

2. **Enable Developer Mode**
   - Toggle the **Developer mode** switch in the top-right corner

3. **Load the extension**
   - Click the **Load unpacked** button
   - Navigate to and select the `chrome-to-nis` folder
   - Click **Select Folder**

4. **Verify installation**
   - You should see "Currency to NIS" appear in your extensions list
   - The extension icon (₪) should be visible

### Step 3: Use the Extension

1. **Select currency text** on any webpage
   - Examples: "$28", "50 EUR", "£100", "28 USD"

2. **Right-click** on the selected text

3. **Click "To NIS"** in the context menu

4. **See the result** in a floating tooltip near the selected text
   - Appears instantly right where you're looking
   - Shows converted amount in NIS (₪)
   - Includes exchange rate information
   - Shows when the exchange rate was last updated
   - Auto-dismisses after 5 seconds

## Supported Currency Formats

The extension recognizes various formats:

| Format | Example | Currency |
|--------|---------|----------|
| Symbol before | $28, €50, £100 | USD, EUR, GBP |
| Symbol after | 28$, 50€, 100£ | USD, EUR, GBP |
| Code before | USD 28, EUR 50 | USD, EUR |
| Code after | 28 USD, 50 EUR | USD, EUR |
| Special symbols | CA$28, AU$50, ¥1000 | CAD, AUD, JPY |

### Supported Currencies

- USD ($) - US Dollar
- EUR (€) - Euro
- GBP (£) - British Pound
- JPY (¥) - Japanese Yen
- CAD (CA$) - Canadian Dollar
- AUD (AU$) - Australian Dollar
- CHF - Swiss Franc
- CNY - Chinese Yuan
- INR (₹) - Indian Rupee
- RUB (₽) - Russian Ruble
- And many more via 3-letter currency codes

## Troubleshooting

### Extension not appearing
- Make sure Developer Mode is enabled
- Try reloading the extension (click the refresh icon)
- Restart Chrome

### "Could not detect currency" error
- Make sure you selected text that includes both a number and currency
- Try formats like: "$28" or "28 USD"
- Currency must be recognized (see supported list above)

### Network errors
- Check your internet connection
- The extension needs access to `api.exchangerate-api.com`
- Some corporate networks may block external API calls

### Wrong conversion result
- Exchange rates are fetched in real-time from ExchangeRate-API
- Rates update regularly but may have slight delays
- For official rates, verify with your bank

## How It Works

1. **Context Menu**: Adds "To NIS" option when you right-click selected text
2. **Currency Detection**: Parses the selected text to extract amount and currency
3. **Smart Cache**: Checks if exchange rate is cached (valid for 1 hour)
4. **API Call**: Fetches current exchange rate from ExchangeRate-API (only if not cached)
5. **Calculation**: Converts the amount to NIS
6. **Tooltip Display**: Shows result in a floating tooltip near the selected text
   - Positioned intelligently (above or below selection based on space)
   - Uses Shadow DOM for style isolation
   - Displays when exchange rate was last updated
   - Auto-dismisses after 5 seconds

**Performance**:
- First conversion per currency: ~1 second (fetches from API)
- Subsequent conversions: **Instant!** (uses cached rate)
- Cache refreshes automatically after 1 hour
- Tooltip appears immediately without notification delay

## API Information

This extension uses the free [ExchangeRate-API](https://www.exchangerate-api.com/) service:
- **Free tier**: 1,500 requests per month
- **No API key required** for basic usage
- **Real-time rates**: Updated regularly

For higher usage, you can sign up for a free API key and modify the API URL in `background.js`.

## Privacy

- ✅ No data collection
- ✅ No tracking
- ✅ Only sends selected text to conversion API
- ✅ All processing happens locally
- ✅ No background data transmission

## Customization

### Change the API provider

Edit `background.js` and modify the API URL:

```javascript
const apiUrl = `https://api.exchangerate-api.com/v4/latest/${currency}`;
```

Popular alternatives:
- [Fixer.io](https://fixer.io/)
- [CurrencyAPI](https://currencyapi.com/)
- [ExchangeRate-API](https://www.exchangerate-api.com/)

### Add more currency symbols

Edit the `currencyMap` object in `background.js`:

```javascript
const currencyMap = {
  '$': 'USD',
  '€': 'EUR',
  // Add your own here
};
```

### Change notification duration

Chrome notifications auto-dismiss after a few seconds. To change behavior, modify the `showNotification` function in `background.js`.

## Uninstalling

1. Go to `chrome://extensions/`
2. Find "Currency to NIS"
3. Click **Remove**
4. Confirm deletion

## License

MIT License - Feel free to modify and use as you wish!

## Support

If you encounter issues:
1. Check the troubleshooting section above
2. Open Chrome DevTools (F12) → Console to see error messages
3. Check `chrome://extensions/` for any error badges on the extension

---

**Enjoy quick currency conversions! 💱₪**
