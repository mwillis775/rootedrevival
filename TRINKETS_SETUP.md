# Rooted Revival Trinkets Store Setup

## Overview
The trinkets store is a separate product catalog and storefront for 3D-printed earrings, charms, and small accessories. It uses a warm, friendly design aesthetic distinct from the main terminal-inspired shop.

## Files
- `trinkets.html` — Storefront page (warm design, friendly colors)
- `products.html` — Main shop page (excludes trinkets)
- `admin.html` — Admin panel (updated with category management)

## Backend Components

### Database
- `server/src/db/shop.js` — Added `category` column to `custom_products` table with auto-migration
- Supports category filtering and exclusion

### API
- `GET /api/shop/products?category=trinkets` — Returns only trinket products
- `GET /api/shop/products?exclude_category=trinkets` — Returns all products except trinkets
- Admin endpoints accept `category` parameter on create/update

### Admin
- Product editor has Category dropdown with "Trinkets" option
- Custom products table displays category badges

## Setup Steps

1. **Restart Server**
   ```bash
   cd server
   npm run dev
   # or
   npm start
   ```
   This triggers the database migration to add the `category` column if needed.

2. **Create Trinket Products in Admin**
   - Navigate to admin panel
   - Click "+ New Product"
   - Fill in product details (name, price, description)
   - Set **Category** dropdown to "Trinkets"
   - Upload images
   - Add options/variants as needed
   - Save product

3. **View Trinkets Store**
   - Navigate to `/trinkets.html`
   - Only products with category="trinkets" will display
   - Cart/checkout shared with main shop

4. **Share on Social Media**
   - `/trinkets.html` has proper OG meta tags for Facebook sharing
   - Link preview will show "Rooted Revival Trinkets" with description

## Product Categorization

### Adding to Trinkets Store
Set category to "trinkets" when creating/editing a product in admin.

### Adding to Main Store Only
Leave category empty or null.

### Important Notes
- Trinkets products do NOT appear in `/products.html` (main shop)
- Main shop `/products.html` automatically excludes trinkets
- Both stores share the same cart (localStorage key: `rr_cart`)
- Same checkout and payment system (Square integration)

## Design Differences

### Trinkets Store (`trinkets.html`)
- Warm palette: cream (#fef9f4), terracotta (#d4764e), sage (#8bab7e)
- Friendly fonts: Quicksand + Nunito (rounded, approachable)
- Soft shadows and rounded UI elements
- No terminal aesthetic
- Perfect for casual Facebook audiences

### Main Shop (`products.html`)
- Terminal aesthetic: green-on-black
- Share Tech Mono monospace font
- Corporate, technical feel
- Grid-based modern layout

## Troubleshooting

### Trinkets not showing up
1. Verify product has category="trinkets" in admin
2. Check browser console for API errors
3. Restart server to ensure DB migration ran

### Products showing in wrong store
1. Check product category in admin
2. Verify API parameters in browser network tab
3. Clear browser cache (localStorage might cache old data)

### Checkout not working
1. Ensure Square config is set in `server/src/config.js`
2. Check that both cart drawer and modal are loading
3. Verify Square SDK loads: `https://web.squarecdn.com/v1/square.js`

## Future Enhancements

Possible category additions:
- Replace `(none)` in admin dropdown with more options
- Add category to product display order sorting
- Create category landing pages beyond just trinkets
- Add category filtering UI to storefront pages
