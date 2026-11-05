# To NIS Chrome Extension

Manifest V3 Chrome extension that converts foreign currency prices on the page to Israeli New Shekel.

## Features

- Right-click selected text like `$28` or `50 EUR` and choose `To NIS`
- Shekel prices (`₪143.19`, `50 NIS`, `100 ש"ח`) are converted the opposite way, to USD
- Select a price and press `Alt+N` (`Option+N` on Mac) to convert it; rebind at `chrome://extensions/shortcuts`
- Right-click without a selection to scan the clicked element for every price it contains
- Fetch live rates from `open.er-api.com` (one request covers all currencies, cached 1 hour in `chrome.storage.local`)
- Show the result as a footnote on the page itself (Shadow DOM overlay, page DOM untouched):
  - the price gets a dotted underline
  - one price: a bubble above it with the NIS amount, rate and rate age; click to copy the amount, or drag it to the left, right, top or bottom of the price (the side is remembered)
  - several prices: an inline NIS chip after each price; click a chip to copy
  - prices that can't be located fall back to a bubble listing every conversion with a total
  - amber when a stale cached rate was used
  - dismiss with `Esc`, a click elsewhere, or let it time out (the countdown pauses on hover)

## Load in Chrome

1. Open `chrome://extensions`
2. Enable `Developer mode`
3. Click `Load unpacked`
4. Select the project folder (the one containing `manifest.json`)

## Notes

- The extension fetches `https://open.er-api.com/v6/latest/ILS` once and inverts the rates, so a single cached table serves every supported currency.
- If a fresh fetch fails but a cached table exists, the extension falls back to it and shows an amber warning state on the tooltip.
