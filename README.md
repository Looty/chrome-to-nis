# To NIS Chrome Extension

Manifest V3 Chrome extension that converts foreign currency prices on the page to Israeli New Shekel.

## Features

- Right-click selected text like `$28` or `50 EUR` and choose `To NIS`
- Right-click without a selection to scan the clicked element for every price it contains
- Fetch live rates from `exchangerate-api.com` (one request covers all currencies, cached 1 hour in `chrome.storage.local`)
- Show a draggable floating tooltip in Shadow DOM with:
  - converted amount
  - exchange rate
  - rate age
  - countdown border (pauses on hover/drag; amber when a stale cached rate was used)
  - dismiss via the close button or `Esc`
  - automatic dark mode (follows the OS `prefers-color-scheme`)

## Load in Chrome

1. Open `chrome://extensions`
2. Enable `Developer mode`
3. Click `Load unpacked`
4. Select this folder:
   `C:\Users\erezm\Documents\Projects\gpttest-nis-ui-modernize`

## Notes

- The extension fetches `https://open.er-api.com/v6/latest/ILS` once and inverts the rates, so a single cached table serves every supported currency.
- If a fresh fetch fails but a cached table exists, the extension falls back to it and shows an amber warning state on the tooltip.
