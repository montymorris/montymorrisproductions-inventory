# Monty Morris Productions: inventory tracker

A small inventory and opportunity tracker. Plain HTML, CSS and JavaScript, no build step. The inventory lives in two spreadsheets in this repo:

- `data/inventory.csv`: one row per asset (asset number, item, hire price, replacement cost, status, opportunity)
- `data/jobs.csv`: one row per opportunity

Both open in Excel, Numbers and Google Sheets. The sample rows can be deleted.

## How it works

- **Inventory:** add an item with a hire price, an optional replacement cost and a quantity. Enter one asset number per item. Items are grouped by name, so two microphones show as "Microphone, Available 2 of 2". Price changes apply to the whole group.
- **Opportunities:** create one with client, venue and in-use and return-by times.
- **Allocate:** on an opportunity, pick an item and quantity. The lowest free asset numbers are allocated.
- **Prepare:** scan or type an asset number. With **Free scan** on (the default), a free asset is allocated and prepared in one go. With it off, only assets already allocated to the opportunity can be prepared. Assets on another opportunity are always refused. The toggle is remembered in the browser.
- **Check in:** the Check in tab works like Prepare. Scan an asset that is booked out on the opportunity and it returns to inventory.
- **Book out:** tick the items (or the top tick box to select all) and press Book out selected. Check in selected returns them to inventory.
- **Job label:** Job label prints the label with a QR code that opens the opportunity. It always says "Picked By: Monty Morris".
- **Kit list:** prints a list grouped by item with tick boxes for out and back, totals and replacement value.

## Keeping the spreadsheets in sync

The repo (`montymorris/montymorrisproductions-inventory`) and branch (`main`) are built into `js/app.js`. The access token is not: enter it once in Settings and it stays saved in that browser.

1. Create a fine-grained personal access token at github.com/settings/tokens, limited to this repository, with **Contents: read and write**.
2. Open Settings, paste the token and press Save and load from GitHub.
3. After that every change is committed to `data/inventory.csv` or `data/jobs.csv` a moment after you make it. The top right shows the sync state.

Notes:

- The token lives in that browser only. Enter it once on each device. Never put it in the code, because GitHub blocks pushes that contain it.
- Without a token the app still works, saving to the browser only, and shows a warning. Use Settings to download the CSVs.
- If someone else edits the CSV on GitHub, the page loads their version when it starts. Two people saving at once means the last save wins.
- In a public repo anyone can read the CSVs. Make the repo private if the inventory list is sensitive.

## Run and deploy

```
python3 -m http.server 8000
```

GitHub Pages: Settings > Pages > Deploy from a branch > `main` / root.

## Structure

```
index.html
css/style.css
js/app.js
js/vendor/qrcode.js   qrcode-generator (MIT)
data/inventory.csv
data/jobs.csv
```
