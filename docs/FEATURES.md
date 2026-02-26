# Currency to NIS - Proposed Features

This document outlines potential feature enhancements for the Currency to NIS Chrome extension based on current functionality and user needs.

## 🚀 High Priority Features

### 1. **Multiple Target Currencies**
Convert to any currency, not just NIS. Allow users to:
- Set a preferred "default" target currency
- Use a popup menu to select different target currencies from recent selections
- Add custom target currencies to a favorites list

**Implementation notes:**
- Modify context menu to show "To [Currency]" instead of just "To NIS"
- Add a settings page where users can choose default currency and manage favorites
- Store user preferences in `chrome.storage.sync`

### 2. **Settings/Options Page**
Create an extension options page with:
- Default currency selection (currently hardcoded to NIS)
- List of favorite/bookmarked currencies
- Toggle for tooltip position (auto/above/below/floating)
- Custom decimal place rounding
- Theme selection (light/dark mode)
- API key input field for higher rate limits

**Implementation notes:**
- Create `options.html`, `options.js`, and `options.css`
- Add `options_page` to manifest.json
- Use `chrome.storage.local` for persistent preferences

### 3. **Popup Menu**
Add a small popup UI (not in context menu) that shows:
- Last converted amounts and rates
- Recently used currencies
- Quick access buttons for top currencies (USD, EUR, GBP, etc.)
- Search for specific currency codes
- One-click currency copying to clipboard

**Implementation notes:**
- Create `popup.html`, `popup.js`, and `popup.css`
- Add `action` to manifest.json
- Display recent conversions from `chrome.storage.local`

### 4. **Multi-currency Batch Conversion**
Allow users to:
- Select multiple currency amounts in a page
- Right-click to convert all at once
- Display results in a summary table

**Implementation notes:**
- Modify content script to detect multiple currency patterns
- Show a summary tooltip or modal with all conversions
- Group results by source currency

## 💾 Medium Priority Features

### 5. **Conversion History**
Track conversion history with:
- Timestamp of each conversion
- Amount, source currency, target currency, exchange rate used
- Ability to view full history in a dedicated page
- Export history as CSV

**Implementation notes:**
- Store in `chrome.storage.local` with date limits (e.g., keep last 30 days)
- Create `history.html` page
- Add date filters and search functionality

### 6. **Offline Mode**
- Cache rates for longer periods when marked as "offline"
- Display cached rates with clear indication of age
- Sync rates periodically when online

**Implementation notes:**
- Add "offline mode" toggle to settings
- Extend cache duration check logic
- Show rate staleness warning in tooltip

### 7. **Keyboard Shortcuts**
- Trigger conversion with keyboard shortcut (e.g., Ctrl+Shift+C)
- Cycle through favorite currencies with shortcut
- Open settings with shortcut

**Implementation notes:**
- Add `commands` to manifest.json
- Add listener in background.js for `chrome.commands.onCommand`

### 8. **Visual Enhancements**
- Tooltip animations (fade, slide, pop)
- Icon badges showing latest conversion rates
- Color-coded tooltips (green for favorable rates, red for unfavorable)
- Currency flag icons in tooltip

**Implementation notes:**
- Enhance CSS animations
- Add dynamic icon badge logic
- Use `chrome.action.setBadgeText()` for badge display

### 9. **Rate Alerts**
- Notify user when exchange rate changes significantly
- Set target rate and get notified when rate hits that level
- Monitor specific currency pairs periodically

**Implementation notes:**
- Store watched rates and thresholds
- Poll API periodically in background script
- Use `chrome.notifications` for alerts

## 🔧 Lower Priority Features

### 10. **Multiple API Providers**
- Add option to switch between exchange rate API providers
- Fallback to alternative provider if primary fails
- Compare rates across providers

**Implementation notes:**
- Create abstract API interface
- Implement adapters for Fixer.io, CurrencyAPI, etc.
- Add health check logic

### 11. **Smart Pattern Recognition**
- Detect prices with currency symbols in context (e.g., "Price: $100")
- Auto-detect currency from website language/locale
- Learn user's most-used currency pairs

**Implementation notes:**
- Enhance regex patterns for more formats
- Use navigator language detection
- Track conversion frequency in storage

### 12. **Calculation Mode**
- Allow quick calculations like "$100 + €50 in NIS"
- Right-click to enter calculation mode
- Support basic arithmetic with multiple currencies

**Implementation notes:**
- Create modal calculator UI
- Parse and evaluate expressions
- Fetch all required rates before calculation

### 13. **Rate Charts**
- Show historical rate trends for selected currency pair
- Visual chart over last 7/30/90 days
- Identify best conversion times

**Implementation notes:**
- Integrate charting library (Chart.js or similar)
- Store historical rates in storage
- Create chart.html page

### 14. **Bulk Conversion Tool**
- Paste list of amounts with currencies
- Get converted results in formatted table
- Copy results to clipboard in various formats

**Implementation notes:**
- Create conversion tool page
- Parse CSV/text input
- Generate formatted output

## 🎨 Enhancement Ideas

### 15. **Theming System**
- Pre-built themes (dark, light, high contrast)
- Custom theme colors
- Persistent theme preference

### 16. **Language Support**
- Internationalization (i18n) for multiple languages
- Locale-specific number formatting
- Right-to-left (RTL) layout support for Hebrew/Arabic

**Implementation notes:**
- Use `chrome.i18n` API
- Create messages.json for translations
- Add RTL CSS support

### 17. **Accessibility Improvements**
- Better ARIA labels in tooltip
- Keyboard navigation support
- High contrast mode support
- Text-to-speech for results

### 18. **Premium/Pro Version**
- Higher API rate limits
- Additional currencies (cryptocurrencies, commodities)
- Advanced analytics and reporting
- Priority support

## 🔒 Security & Privacy Features

### 19. **Rate Limit Display**
- Show API usage and remaining requests
- Warn when approaching limit
- Suggest user upgrades to paid API

### 20. **Privacy Dashboard**
- Show what data is being sent/stored
- Clear cache and history controls
- Export personal data

## 📊 Data & Analytics

### 21. **Conversion Statistics**
- Most frequently converted currencies
- Most used source/target pairs
- Average amounts converted
- Trends over time

### 22. **Exchange Rate Notifications**
- Daily digest of rate changes
- Weekly summary email (optional)
- Rate comparison alerts

## 🔌 Integration Ideas

### 23. **Browser Sync**
- Sync settings across devices
- Cloud backup of history
- Share conversions with other devices

### 24. **Context-Aware Conversion**
- Detect shopping websites and auto-show prices in NIS
- Price comparison across different currencies
- Real-time price tracking

## 📱 Platform Expansion

### 25. **Cross-browser Support**
- Port to Firefox, Edge, Safari
- Maintain feature parity

### 26. **Web App Version**
- Standalone web converter tool
- Shareable links for conversion results
- Embeddable widget for websites

---

## Priority Recommendation

**Phase 1 (MVP+):** Features 1-4
- Opens up significant functionality with minimal complexity
- Addresses most common user needs

**Phase 2 (Enhancement):** Features 5-9
- Improves user experience and power-user features
- Moderate complexity

**Phase 3 (Advanced):** Features 10+
- Specialty features for power users
- Consider feature flags or premium tier

---

## Feedback Welcome

This is a living document. User feedback and usage patterns should guide which features to prioritize next!
