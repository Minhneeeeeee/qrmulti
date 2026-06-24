# QRcode 1 · QR Multi

Standalone multilingual QR generator for `qrmulti.com`.

## Included
- Vietnamese, Simplified Chinese and English routes
- Text, URL, Wi-Fi and vCard QR codes
- Local browser-only processing
- Logo upload and style controls
- PNG/SVG download and PNG clipboard copy
- Cloudflare Pages headers, redirects, robots.txt and sitemap.xml
- Canonical, hreflang, Open Graph and WebApplication structured data

## Deploy to Cloudflare Pages
1. Create a GitHub repository and upload the contents of this folder.
2. In Cloudflare Dashboard, open **Workers & Pages → Create → Pages → Connect to Git**.
3. Framework preset: **None**.
4. Build command: leave empty.
5. Build output directory: `/`.
6. After deployment, open **Custom domains** and add `qrmulti.com`.
7. Add `www.qrmulti.com` too, then redirect it to the apex domain if desired.

## Local preview
Run any static HTTP server, for example:

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080/vi/`.

## Library
Uses `qr-code-styling` 1.9.2 under the MIT License. A copy of its license is in `assets/vendor/`.
