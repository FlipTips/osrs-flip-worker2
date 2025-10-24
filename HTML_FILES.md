# HTML Files Location

This repository contains the following HTML files for the OSRS FlipTips application:

## Current HTML Files

1. **`index.html`** - Main list page template
   - Displays the list of items with flip tips
   - Includes filters, search, and pagination controls
   - Shows live price data for OSRS items in parchment-style cards

2. **`item.html`** - Individual item page template
   - Displays detailed information for a single item
   - Shows instant buy/sell prices, ROI, yield after tax, etc.
   - Includes navigation links back to the main list

## Usage

These HTML templates are embedded in the Cloudflare Worker (`worker.js`) and served dynamically with data from the OSRS Wiki API. The templates use placeholder variables that are replaced at runtime:

- `{{PARCH_URL}}` - URL to the parchment background image
- `{{STALE_SEC_MS}}` - Milliseconds threshold for stale data warning
- `{{ITEM_NAME}}`, `{{ITEM_ICON}}`, etc. - Dynamic item data

## Note

While these HTML files are extracted for reference and easier editing, the actual serving logic is handled by the Cloudflare Worker in `worker.js`. To deploy changes to the HTML, you would need to update the corresponding functions in `worker.js`:

- `pageHTML()` for the main list page
- `itemPageHTML(item)` for individual item pages
