/**
 * Shop Routes - Printful catalog + Custom products + Square payments + Order tracking
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('./config');
const { auth, parseMultipart } = require('./http');
const shop = require('./db/shop');

const PRINTFUL_API = 'https://api.printful.com';
const SQUARE_API = 'https://connect.squareup.com';
const SHOP_IMAGES_DIR = path.resolve(config.rootDir, '..', 'site', 'shop');
const CUSTOM_IMAGES_DIR = path.resolve(config.uploadsDir, 'shop');
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif']);
const ALLOWED_IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif']);

// ========== Printful helpers ==========

function slugify(name) {
    return String(name).toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80) || 'product';
}

function ensureProductDir(name) {
    const dir = path.join(SHOP_IMAGES_DIR, slugify(name));
    try {
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    } catch (err) {
        console.error(`Failed to create product dir ${dir}:`, err.message);
    }
}

function getLocalImages(name) {
    const slug = slugify(name);
    const dir = path.join(SHOP_IMAGES_DIR, slug);
    try {
        if (!fs.existsSync(dir)) return [];
        return fs.readdirSync(dir)
            .filter(f => IMAGE_EXTENSIONS.has(path.extname(f).toLowerCase()))
            .sort()
            .map(f => ({ filename: f, url: `/shop/${slug}/${f}` }));
    } catch { return []; }
}

function getColorImages(syncVariants) {
    const colorImages = {};
    for (const sv of syncVariants) {
        const color = sv.color;
        if (!color || colorImages[color]) continue;
        const previewFile = (sv.files || []).find(f => f.type === 'preview' && f.preview_url);
        if (previewFile) {
            colorImages[color] = {
                preview_url: previewFile.preview_url,
                thumbnail_url: previewFile.thumbnail_url || previewFile.preview_url
            };
        }
    }
    return colorImages;
}

function printfulRequest(reqPath) {
    return new Promise((resolve, reject) => {
        const url = new URL(reqPath, PRINTFUL_API);
        const req = https.get(url, {
            headers: {
                'Authorization': `Bearer ${config.printfulApiToken}`,
                'Content-Type': 'application/json'
            }
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    if (parsed.code === 200) resolve(parsed);
                    else reject(new Error(parsed.result || 'Printful API error'));
                } catch (e) {
                    reject(new Error('Failed to parse Printful response'));
                }
            });
        });
        req.on('error', reject);
        req.setTimeout(10000, () => { req.destroy(); reject(new Error('Printful request timeout')); });
    });
}

function printfulPost(reqPath, body) {
    return new Promise((resolve, reject) => {
        const url = new URL(reqPath, PRINTFUL_API);
        const payload = JSON.stringify(body);
        const req = https.request(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${config.printfulApiToken}`,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload)
            }
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
            });
        });
        req.on('error', reject);
        req.setTimeout(20000, () => { req.destroy(); reject(new Error('Printful request timeout')); });
        req.write(payload);
        req.end();
    });
}

function squareRequest(method, reqPath, body) {
    return new Promise((resolve, reject) => {
        const url = new URL(reqPath, SQUARE_API);
        const payload = JSON.stringify(body);
        const req = https.request(url, {
            method,
            headers: {
                'Authorization': `Bearer ${config.squareAccessToken}`,
                'Content-Type': 'application/json',
                'Square-Version': '2024-01-18',
                'Content-Length': Buffer.byteLength(payload)
            }
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); } catch (e) { reject(new Error('Failed to parse Square response')); }
            });
        });
        req.on('error', reject);
        req.setTimeout(15000, () => { req.destroy(); reject(new Error('Square request timeout')); });
        req.write(payload);
        req.end();
    });
}

// ========== Auth middleware ==========

function requireAdmin(req, res, next) {
    if (!req.user || !req.user.isAdmin) return res.error('Forbidden', 403);
    return next();
}

function requireU2FAdmin(req, res, next) {
    if (!req.user || !req.user.isAdmin) return res.error('Forbidden', 403);
    if (!req.u2fVerified) {
        const { getDb } = require('./db/index');
        const db = getDb();
        const creds = db.prepare('SELECT COUNT(*) as c FROM webauthn_credentials WHERE user_id = ?').get(req.user.id);
        if (creds && creds.c > 0) return res.error('Hardware key verification required', 403);
    }
    return next();
}

// ========== Format custom product for public API ==========

function formatCustomProductForShop(product) {
    const groups = product.option_groups || [];
    const firstGroup = groups[0];

    // Build color_images from first option group's tagged images
    const color_images = {};
    if (firstGroup) {
        for (const val of firstGroup.values) {
            const img = product.images.find(i => i.option_value_id === val.id);
            if (img) {
                color_images[val.label] = {
                    preview_url: `/api/shop/images/${img.filename}`,
                    thumbnail_url: `/api/shop/images/${img.filename}`
                };
            }
        }
    }

    // Build variants
    const variants = (product.variants || []).filter(v => v.active).map(v => {
        const combo = v.option_combo || [];
        const colorEntry = combo.find(c => firstGroup && c.group_id === firstGroup.id);
        const otherEntries = combo.filter(c => c !== colorEntry);

        return {
            id: v.id,
            name: combo.map(c => c.value_label).join(' / ') || product.name,
            color: colorEntry?.value_label || '',
            size: otherEntries.map(c => c.value_label).join(' / ') || '',
            retail_price: String(v.price != null ? v.price : product.base_price),
            currency: 'USD',
            variant_id: v.id,
            availability_status: v.stock === 0 ? 'sold_out' : 'active'
        };
    });

    // If no option groups or variants, create a default variant
    if (!variants.length && product.active) {
        variants.push({
            id: 0,
            name: product.name,
            color: '',
            size: '',
            retail_price: String(product.base_price),
            currency: 'USD',
            variant_id: 0,
            availability_status: 'active'
        });
    }

    // Merge DB images with any files manually placed in site/shop/<slug>/
    const siteLocalImages = getLocalImages(product.name);
    const dbLocalImages = product.images.map(img => ({
        filename: img.original_filename || img.filename,
        url: `/api/shop/images/${img.filename}`,
        option_value_id: img.option_value_id
    }));
    // Avoid duplicates: site files that aren't already in DB images
    const dbFilenames = new Set(product.images.map(i => i.filename));
    const mergedLocalImages = [
        ...dbLocalImages,
        ...siteLocalImages.filter(si => !dbFilenames.has(si.filename))
    ];

    const firstImage = product.images[0];
    const thumbUrl = firstImage
        ? `/api/shop/images/${firstImage.filename}`
        : (siteLocalImages.length ? siteLocalImages[0].url : '');

    return {
        id: `custom-${product.id}`,
        source: 'custom',
        custom_id: product.id,
        name: product.name,
        description: product.description || '',
        thumbnail_url: thumbUrl,
        images: product.images.filter(img => !img.option_value_id).slice(0, 1).map(img => ({
            type: 'preview',
            preview_url: `/api/shop/images/${img.filename}`,
            thumbnail_url: `/api/shop/images/${img.filename}`
        })),
        color_images,
        local_images: mergedLocalImages,
        variants,
        base_price: product.base_price,
        option_groups: groups.map(g => ({
            id: g.id,
            name: g.name,
            values: g.values.map(v => ({ id: v.id, label: v.label }))
        }))
    };
}

// ========== Sanitize string ==========
function sanitizeStr(str, maxLen = 200) {
    return typeof str === 'string' ? str.trim().slice(0, maxLen) : '';
}

function sanitizeAddress(addr) {
    return {
        name: sanitizeStr(addr.name),
        email: sanitizeStr(addr.email, 254),
        address1: sanitizeStr(addr.address1),
        address2: sanitizeStr(addr.address2),
        city: sanitizeStr(addr.city),
        state: sanitizeStr(addr.state_code || addr.state, 10),
        zip: sanitizeStr(addr.zip, 20),
        country: sanitizeStr(addr.country_code || addr.country, 2).toUpperCase() || 'US'
    };
}

// ========== Register all routes ==========

function registerShopRoutes(app) {

    // Ensure custom images directory exists
    if (!fs.existsSync(CUSTOM_IMAGES_DIR)) {
        fs.mkdirSync(CUSTOM_IMAGES_DIR, { recursive: true });
    }

    // ────────────────────────────────────────────
    // PUBLIC: Shop config
    // ────────────────────────────────────────────
    app.get('/api/shop/config', async (req, res) => {
        res.json({
            squareApplicationId: config.squareApplicationId,
            squareLocationId: config.squareLocationId,
            squareEnvironment: config.squareEnvironment
        });
    });

    // ────────────────────────────────────────────
    // PUBLIC: List ALL products (Printful + custom)
    // ────────────────────────────────────────────
    app.get('/api/shop/products', async (req, res) => {
        try {
            const results = [];

            // Fetch Printful products if configured
            if (config.printfulApiToken) {
                try {
                    const data = await printfulRequest('/store/products');
                    const products = data.result || [];
                    const detailed = await Promise.all(
                        products.map(async (p) => {
                            try {
                                const detail = await printfulRequest(`/store/products/${p.id}`);
                                const sp = detail.result.sync_product;
                                const syncVariants = detail.result.sync_variants || [];
                                ensureProductDir(sp.name);
                                const images = [];
                                if (syncVariants.length > 0) {
                                    for (const file of (syncVariants[0].files || [])) {
                                        if (file.preview_url) {
                                            images.push({
                                                type: file.type,
                                                preview_url: file.preview_url,
                                                thumbnail_url: file.thumbnail_url || file.preview_url
                                            });
                                        }
                                    }
                                }
                                const color_images = getColorImages(syncVariants);
                                const variants = syncVariants.map(sv => ({
                                    id: sv.id,
                                    name: sv.name,
                                    size: sv.size,
                                    color: sv.color,
                                    retail_price: sv.retail_price,
                                    currency: sv.currency || 'USD',
                                    variant_id: sv.variant_id,
                                    availability_status: sv.availability_status
                                }));
                                return {
                                    id: sp.id,
                                    source: 'printful',
                                    name: sp.name,
                                    thumbnail_url: sp.thumbnail_url,
                                    images,
                                    color_images,
                                    local_images: getLocalImages(sp.name),
                                    variants
                                };
                            } catch { return null; }
                        })
                    );
                    results.push(...detailed.filter(Boolean));
                } catch (err) {
                    console.error('Printful products error:', err.message);
                }
            }

            // Fetch custom products
            const customProducts = shop.listProducts({ activeOnly: true });
            for (const cp of customProducts) {
                results.push(formatCustomProductForShop(cp));
            }

            // Apply saved display order
            const orderMap = {};
            shop.getDisplayOrder().forEach(o => { orderMap[o.product_key] = o.sort_order; });
            results.sort((a, b) => {
                const oa = orderMap[String(a.id)] ?? 9999;
                const ob = orderMap[String(b.id)] ?? 9999;
                return oa - ob;
            });

            res.json({ products: results });
        } catch (err) {
            console.error('Products error:', err.message);
            res.error('Failed to load products', 500);
        }
    });

    // ────────────────────────────────────────────
    // PUBLIC: Single product detail
    // ────────────────────────────────────────────
    app.get('/api/shop/products/:id', async (req, res) => {
        const id = req.params.id;

        // Custom product
        if (typeof id === 'string' && id.startsWith('custom-')) {
            const customId = parseInt(id.replace('custom-', ''));
            const product = shop.getProduct(customId);
            if (!product || !product.active) return res.error('Product not found', 404);
            return res.json({ product: formatCustomProductForShop(product) });
        }

        // Printful product
        if (!config.printfulApiToken) return res.error('Shop not configured', 503);
        try {
            const detail = await printfulRequest(`/store/products/${id}`);
            const sp = detail.result.sync_product;
            const syncVariants = detail.result.sync_variants || [];
            ensureProductDir(sp.name);
            const images = [];
            if (syncVariants.length > 0) {
                for (const file of (syncVariants[0].files || [])) {
                    if (file.preview_url) {
                        images.push({ type: file.type, preview_url: file.preview_url, thumbnail_url: file.thumbnail_url || file.preview_url });
                    }
                }
            }
            const color_images = getColorImages(syncVariants);
            const variants = syncVariants.map(sv => ({
                id: sv.id, name: sv.name, size: sv.size, color: sv.color,
                retail_price: sv.retail_price, currency: sv.currency || 'USD',
                variant_id: sv.variant_id, availability_status: sv.availability_status
            }));
            res.json({
                product: {
                    id: sp.id, source: 'printful', name: sp.name, thumbnail_url: sp.thumbnail_url,
                    images, color_images, local_images: getLocalImages(sp.name), variants
                }
            });
        } catch (err) {
            console.error('Printful product error:', err.message);
            res.error('Failed to load product', 502);
        }
    });

    // ────────────────────────────────────────────
    // PUBLIC: Serve custom product images
    // ────────────────────────────────────────────
    app.get('/api/shop/images/:filename', async (req, res) => {
        const filename = path.basename(req.params.filename);
        if (!filename || filename.startsWith('.')) return res.error('Not found', 404);
        const filepath = path.join(CUSTOM_IMAGES_DIR, filename);
        if (!fs.existsSync(filepath)) return res.error('Not found', 404);

        const ext = path.extname(filename).toLowerCase();
        const mimeMap = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif' };
        const ct = mimeMap[ext] || 'application/octet-stream';

        const stat = fs.statSync(filepath);
        res.writeHead(200, {
            'Content-Type': ct,
            'Content-Length': stat.size,
            'Cache-Control': 'public, max-age=86400'
        });
        fs.createReadStream(filepath).pipe(res);
    });

    // Serve product images from site/shop/<slug>/ (for API-origin access)
    app.get('/shop/:slug/:filename', async (req, res) => {
        const slug = path.basename(req.params.slug);
        const filename = path.basename(req.params.filename);
        if (!slug || !filename || filename.startsWith('.')) return res.error('Not found', 404);
        if (!IMAGE_EXTENSIONS.has(path.extname(filename).toLowerCase())) return res.error('Not found', 404);
        const filepath = path.join(SHOP_IMAGES_DIR, slug, filename);
        if (!fs.existsSync(filepath)) return res.error('Not found', 404);

        const ext = path.extname(filename).toLowerCase();
        const mimeMap = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif' };
        const ct = mimeMap[ext] || 'application/octet-stream';
        const stat = fs.statSync(filepath);
        res.writeHead(200, {
            'Content-Type': ct,
            'Content-Length': stat.size,
            'Cache-Control': 'public, max-age=86400'
        });
        fs.createReadStream(filepath).pipe(res);
    });

    // ────────────────────────────────────────────
    // PUBLIC: Checkout (Printful + Custom + billing/shipping)
    // ────────────────────────────────────────────
    app.post('/api/shop/checkout', async (req, res) => {
        if (!config.squareAccessToken) return res.error('Payments not configured', 503);

        const { source_id, billing, shipping: shippingRaw } = req.body || {};

        // Support both new billing/shipping and legacy single-address format
        let billingAddr, shippingAddr;
        if (billing) {
            billingAddr = sanitizeAddress(billing);
            shippingAddr = shippingRaw ? sanitizeAddress(shippingRaw) : { ...billingAddr };
        } else if (req.body.shipping) {
            // Legacy: single shipping address used for both
            const legacy = sanitizeAddress(req.body.shipping);
            billingAddr = { ...legacy };
            shippingAddr = { ...legacy };
        } else {
            return res.error('Missing address information', 400);
        }

        // Validate addresses
        if (!billingAddr.name || !billingAddr.address1 || !billingAddr.city || !billingAddr.zip || !billingAddr.country) {
            return res.error('Incomplete billing address', 400);
        }
        if (!shippingAddr.name || !shippingAddr.address1 || !shippingAddr.city || !shippingAddr.zip || !shippingAddr.country) {
            return res.error('Incomplete shipping address', 400);
        }

        // Parse items
        let items = req.body.items;
        if (!items && req.body.variant_id) {
            items = [{ variant_id: req.body.variant_id, quantity: req.body.quantity || 1, source: 'printful' }];
        }
        if (!source_id || !items || !items.length) {
            return res.error('Missing required fields: source_id, items', 400);
        }
        if (items.length > 20) return res.error('Too many items', 400);

        // Split items by source
        const printfulItems = [];
        const customItems = [];
        for (const it of items) {
            const sanitized = {
                variant_id: parseInt(it.variant_id),
                quantity: Math.min(Math.max(parseInt(it.quantity) || 1, 1), 10),
                source: it.source || 'printful'
            };
            if (sanitized.variant_id <= 0 && sanitized.source !== 'custom') continue;
            if (sanitized.source === 'custom') {
                sanitized.custom_product_id = parseInt(it.custom_product_id) || 0;
                customItems.push(sanitized);
            } else {
                printfulItems.push(sanitized);
            }
        }

        if (!printfulItems.length && !customItems.length) return res.error('No valid items', 400);

        try {
            let totalCents = 0;
            const orderItems = [];

            // 1. Look up Printful variant prices
            const printfulVariantDetails = [];
            if (printfulItems.length && config.printfulApiToken) {
                for (const it of printfulItems) {
                    const vd = await printfulRequest(`/store/variants/${it.variant_id}`);
                    const v = vd.result;
                    const price = parseFloat(v.retail_price);
                    if (!price || price <= 0) throw new Error(`Invalid price for variant ${it.variant_id}`);
                    printfulVariantDetails.push({ ...it, price, currency: v.currency || 'USD', name: v.name });
                    totalCents += Math.round(price * it.quantity * 100);
                    orderItems.push({
                        product_name: v.product?.name || v.name || 'Printful Item',
                        variant_desc: v.name,
                        price: price,
                        quantity: it.quantity,
                        source: 'printful',
                        source_variant_id: it.variant_id
                    });
                }
            }

            // 2. Look up custom product prices
            const customVariantDetails = [];
            for (const it of customItems) {
                let price, productName, variantDesc;
                if (it.variant_id > 0) {
                    // Variant-based custom product
                    const { getDb } = require('./db/index');
                    const db = getDb();
                    const variant = db.prepare('SELECT * FROM custom_product_variants WHERE id = ? AND active = 1').get(it.variant_id);
                    if (!variant) throw new Error(`Custom variant ${it.variant_id} not found`);
                    const product = db.prepare('SELECT * FROM custom_products WHERE id = ? AND active = 1').get(variant.product_id);
                    if (!product) throw new Error(`Custom product not found`);
                    price = variant.price != null ? variant.price : product.base_price;
                    productName = product.name;
                    let combo = [];
                    try { combo = JSON.parse(variant.option_combo); } catch {}
                    variantDesc = combo.map(c => c.value_label).join(' / ');
                    it.custom_product_id = product.id;
                } else {
                    // No-variant custom product (base price)
                    const product = shop.getProduct(it.custom_product_id);
                    if (!product || !product.active) throw new Error(`Custom product ${it.custom_product_id} not found`);
                    price = product.base_price;
                    productName = product.name;
                    variantDesc = '';
                }
                if (!price || price <= 0) throw new Error('Invalid price for custom product');

                // Check stock
                if (it.variant_id > 0) {
                    const { getDb } = require('./db/index');
                    const db = getDb();
                    const variant = db.prepare('SELECT stock FROM custom_product_variants WHERE id = ?').get(it.variant_id);
                    if (variant && variant.stock >= 0 && variant.stock < it.quantity) {
                        throw new Error(`Insufficient stock for ${productName}`);
                    }
                }

                customVariantDetails.push({ ...it, price, name: productName });
                totalCents += Math.round(price * it.quantity * 100);
                orderItems.push({
                    product_name: productName,
                    variant_desc: variantDesc,
                    price: price,
                    quantity: it.quantity,
                    source: 'custom',
                    source_variant_id: it.variant_id || null,
                    source_product_id: it.custom_product_id
                });
            }

            if (totalCents <= 0) throw new Error('Invalid order total');

            const totalDollars = (totalCents / 100).toFixed(2);
            const allNames = [...printfulVariantDetails, ...customVariantDetails].map(v => `${v.name} x${v.quantity}`);
            const idempotencyKey = `${Date.now()}-cart-${crypto.randomBytes(4).toString('hex')}`;

            // 3. Charge via Square
            const paymentBody = {
                source_id,
                idempotency_key: idempotencyKey,
                amount_money: { amount: totalCents, currency: 'USD' },
                location_id: config.squareLocationId,
                note: `Rooted Revival: ${allNames.join(', ')}`.slice(0, 500)
            };
            // Add billing address for AVS
            if (billingAddr.address1) {
                paymentBody.billing_address = {
                    address_line_1: billingAddr.address1,
                    address_line_2: billingAddr.address2 || undefined,
                    locality: billingAddr.city,
                    administrative_district_level_1: billingAddr.state || undefined,
                    postal_code: billingAddr.zip,
                    country: billingAddr.country
                };
            }

            const payment = await squareRequest('POST', '/v2/payments', paymentBody);
            if (payment.errors) {
                const msg = payment.errors.map(e => e.detail).join('; ');
                console.error('Square payment error:', msg);
                return res.error(`Payment failed: ${msg}`, 402);
            }

            const paymentId = payment.payment?.id;
            let printfulOrderId = null;
            let orderWarning = null;

            // 4. Create Printful order if applicable
            if (printfulVariantDetails.length && config.printfulApiToken) {
                const pfTotalCents = printfulVariantDetails.reduce((s, v) => s + Math.round(v.price * v.quantity * 100), 0);
                const pfTotal = (pfTotalCents / 100).toFixed(2);

                const pfOrder = await printfulPost('/orders?confirm=true', {
                    recipient: {
                        name: shippingAddr.name,
                        address1: shippingAddr.address1,
                        address2: shippingAddr.address2 || '',
                        city: shippingAddr.city,
                        state_code: shippingAddr.state || '',
                        country_code: shippingAddr.country,
                        zip: shippingAddr.zip,
                        email: shippingAddr.email || billingAddr.email || ''
                    },
                    items: printfulVariantDetails.map(v => ({
                        sync_variant_id: v.variant_id,
                        quantity: v.quantity
                    })),
                    retail_costs: { subtotal: pfTotal, total: pfTotal }
                });

                if (pfOrder.code !== 200) {
                    console.error('Printful order error:', pfOrder.result || pfOrder.error);
                    console.error(`ALERT: Payment ${paymentId} succeeded but Printful order failed.`);
                    orderWarning = 'Printful items are being fulfilled manually — you will receive a confirmation email.';
                } else {
                    printfulOrderId = pfOrder.result?.id;
                }
            }

            // 5. Track custom items stock
            if (customVariantDetails.length) {
                const { getDb } = require('./db/index');
                const db = getDb();
                for (const it of customVariantDetails) {
                    if (it.variant_id > 0) {
                        db.prepare(
                            'UPDATE custom_product_variants SET stock = stock - ? WHERE id = ? AND stock >= 0'
                        ).run(it.quantity, it.variant_id);
                    }
                }
            }

            // 6. Save order to DB
            const order = shop.createOrder({
                payment_id: paymentId,
                billing: billingAddr,
                shipping: shippingAddr,
                items: orderItems,
                subtotal: parseFloat(totalDollars),
                total: parseFloat(totalDollars),
                has_printful_items: printfulVariantDetails.length > 0,
                printful_order_id: printfulOrderId ? String(printfulOrderId) : null
            });

            const response = {
                success: true,
                payment_id: paymentId,
                order_number: order.order_number,
                amount: totalDollars,
                message: 'Order placed successfully! You will receive shipping updates via email.'
            };
            if (printfulOrderId) response.printful_order_id = printfulOrderId;
            if (orderWarning) response.order_warning = orderWarning;

            res.json(response);

        } catch (err) {
            console.error('Checkout error:', err.message);
            res.error(err.message || 'Checkout failed — please try again', 500);
        }
    });

    // ────────────────────────────────────────────
    // PUBLIC: Shipping estimate (Printful only)
    // ────────────────────────────────────────────
    app.post('/api/shop/shipping-estimate', async (req, res) => {
        if (!config.printfulApiToken) return res.error('Shop not configured', 503);
        const { variant_id, quantity, address } = req.body || {};
        if (!variant_id || !address || !address.country_code) return res.error('Missing variant_id or address', 400);

        try {
            const rates = await printfulPost('/shipping/rates', {
                recipient: {
                    country_code: address.country_code,
                    state_code: address.state_code || '',
                    city: address.city || '',
                    zip: address.zip || ''
                },
                items: [{ variant_id: String(variant_id), quantity: parseInt(quantity) || 1 }]
            });

            if (rates.code === 200) res.json({ rates: rates.result });
            else res.error('Could not estimate shipping', 502);
        } catch (err) {
            console.error('Shipping estimate error:', err.message);
            res.error('Shipping estimate failed', 500);
        }
    });

    // ════════════════════════════════════════════
    // ADMIN: Custom Product CRUD
    // ════════════════════════════════════════════

    // List custom products (admin)
    app.get('/api/shop/admin/products', async (req, res) => {
        await auth({ required: true })(req, res, async () => {
            await requireAdmin(req, res, async () => {
                const products = shop.listProducts();
                res.json({ products });
            });
        });
    });

    // List ALL products for reordering (Printful + custom, with display order)
    app.get('/api/shop/admin/all-products', async (req, res) => {
        await auth({ required: true })(req, res, async () => {
            await requireAdmin(req, res, async () => {
                const all = [];

                // Printful products
                if (config.printfulApiToken) {
                    try {
                        const data = await printfulRequest('/store/products');
                        for (const p of (data.result || [])) {
                            all.push({
                                key: String(p.id),
                                source: 'printful',
                                name: p.name,
                                thumbnail_url: p.thumbnail_url || ''
                            });
                        }
                    } catch (err) {
                        console.error('Printful list error:', err.message);
                    }
                }

                // Custom products
                const customs = shop.listProducts();
                for (const cp of customs) {
                    const thumb = cp.images?.[0] ? `/api/shop/images/${cp.images[0].filename}` : '';
                    const siteImgs = getLocalImages(cp.name);
                    all.push({
                        key: `custom-${cp.id}`,
                        source: 'custom',
                        name: cp.name,
                        thumbnail_url: thumb || (siteImgs[0]?.url || ''),
                        active: !!cp.active
                    });
                }

                // Apply saved display order
                const orderMap = {};
                shop.getDisplayOrder().forEach(o => { orderMap[o.product_key] = o.sort_order; });
                all.sort((a, b) => {
                    const oa = orderMap[a.key] ?? 9999;
                    const ob = orderMap[b.key] ?? 9999;
                    return oa - ob;
                });

                res.json({ products: all });
            });
        });
    });

    // Save product display order
    app.put('/api/shop/admin/display-order', async (req, res) => {
        await auth({ required: true })(req, res, async () => {
            await requireAdmin(req, res, async () => {
                const { order } = req.body || {};
                if (!Array.isArray(order)) return res.error('order must be an array of product keys');
                shop.setDisplayOrder(order);
                res.json({ success: true });
            });
        });
    });

    // Get single custom product (admin)
    app.get('/api/shop/admin/products/:id', async (req, res) => {
        await auth({ required: true })(req, res, async () => {
            await requireAdmin(req, res, async () => {
                const product = shop.getProduct(parseInt(req.params.id));
                if (!product) return res.error('Product not found', 404);
                // Add image URLs for DB images
                for (const img of product.images) {
                    img.url = `/api/shop/images/${img.filename}`;
                }
                // Include any manually-placed site/shop/<slug>/ images
                const siteImages = getLocalImages(product.name);
                const dbFilenames = new Set(product.images.map(i => i.filename));
                product.site_images = siteImages.filter(si => !dbFilenames.has(si.filename));
                res.json({ product });
            });
        });
    });

    // Create custom product
    app.post('/api/shop/admin/products', async (req, res) => {
        await auth({ required: true })(req, res, async () => {
            await requireU2FAdmin(req, res, async () => {
                const { name, description, base_price } = req.body || {};
                if (!name || !name.trim()) return res.error('Product name is required');
                if (base_price === undefined || parseFloat(base_price) < 0) return res.error('Valid price is required');
                const product = shop.createProduct({
                    name: sanitizeStr(name, 200),
                    description: sanitizeStr(description, 5000),
                    base_price: parseFloat(base_price) || 0
                });
                // Create site/shop/<slug>/ directory for GrabNet publishing
                ensureProductDir(product.name);
                res.json({ product }, 201);
            });
        });
    });

    // Update custom product
    app.put('/api/shop/admin/products/:id', async (req, res) => {
        await auth({ required: true })(req, res, async () => {
            await requireU2FAdmin(req, res, async () => {
                const existing = shop.getProduct(parseInt(req.params.id));
                if (!existing) return res.error('Product not found', 404);
                const { name, description, base_price, active } = req.body || {};
                const product = shop.updateProduct(parseInt(req.params.id), {
                    name: name !== undefined ? sanitizeStr(name, 200) : undefined,
                    description: description !== undefined ? sanitizeStr(description, 5000) : undefined,
                    base_price: base_price !== undefined ? parseFloat(base_price) : undefined,
                    active
                });
                res.json({ product });
            });
        });
    });

    // Delete custom product
    app.delete('/api/shop/admin/products/:id', async (req, res) => {
        await auth({ required: true })(req, res, async () => {
            await requireU2FAdmin(req, res, async () => {
                const product = shop.getProduct(parseInt(req.params.id));
                if (!product) return res.error('Product not found', 404);
                // Delete associated image files
                for (const img of product.images) {
                    const filepath = path.join(CUSTOM_IMAGES_DIR, img.filename);
                    try { if (fs.existsSync(filepath)) fs.unlinkSync(filepath); } catch {}
                }
                shop.deleteProduct(parseInt(req.params.id));
                res.json({ success: true });
            });
        });
    });

    // ────────────────────────────────────────────
    // ADMIN: Product Images
    // ────────────────────────────────────────────

    // Upload images (bulk)
    app.post('/api/shop/admin/products/:id/images', async (req, res) => {
        await auth({ required: true })(req, res, async () => {
            await requireU2FAdmin(req, res, async () => {
                const product = shop.getProduct(parseInt(req.params.id));
                if (!product) return res.error('Product not found', 404);

                console.log('[image-upload] product:', product.id, '| files:', req.files?.length || 0,
                    '| types:', (req.files || []).map(f => f.mimeType).join(', '));

                if (!req.files || !req.files.length) return res.error('No files uploaded');

                const results = [];
                for (const file of req.files) {
                    if (!ALLOWED_IMAGE_MIMES.has(file.mimeType)) {
                        console.log('[image-upload] skipped: bad mime', file.mimeType);
                        continue;
                    }
                    if (file.size > 25 * 1024 * 1024) {
                        console.log('[image-upload] skipped: too large', file.size);
                        continue;
                    }

                    const ext = path.extname(file.filename || '').toLowerCase() ||
                        '.' + (file.mimeType.split('/')[1] || 'jpg');
                    const safeExt = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif'].includes(ext) ? ext : '.jpg';
                    const diskName = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${safeExt}`;
                    const filepath = path.join(CUSTOM_IMAGES_DIR, diskName);

                    fs.writeFileSync(filepath, file.buffer);

                    // Also copy to site/shop/<slug>/ for GrabNet publishing
                    const siteDir = path.join(SHOP_IMAGES_DIR, product.slug);
                    try {
                        if (!fs.existsSync(siteDir)) fs.mkdirSync(siteDir, { recursive: true });
                        fs.writeFileSync(path.join(siteDir, diskName), file.buffer);
                    } catch (e) {
                        console.error('[image-upload] site copy failed:', e.message);
                    }

                    const img = shop.addProductImage(parseInt(req.params.id), {
                        filename: diskName,
                        originalFilename: file.filename,
                        mimeType: file.mimeType,
                        fileSize: file.size
                    });
                    img.url = `/api/shop/images/${diskName}`;
                    results.push(img);
                }

                console.log('[image-upload] saved:', results.length, 'images');
                res.json({ images: results }, 201);
            });
        });
    });

    // Update image option value tag
    app.put('/api/shop/admin/images/:imageId/tag', async (req, res) => {
        await auth({ required: true })(req, res, async () => {
            await requireAdmin(req, res, async () => {
                const { option_value_id } = req.body || {};
                shop.updateImageOptionValue(parseInt(req.params.imageId), option_value_id ? parseInt(option_value_id) : null);
                res.json({ success: true });
            });
        });
    });

    // Delete image
    app.delete('/api/shop/admin/images/:imageId', async (req, res) => {
        await auth({ required: true })(req, res, async () => {
            await requireU2FAdmin(req, res, async () => {
                const img = shop.deleteProductImage(parseInt(req.params.imageId));
                if (!img) return res.error('Image not found', 404);
                const filepath = path.join(CUSTOM_IMAGES_DIR, img.filename);
                try { if (fs.existsSync(filepath)) fs.unlinkSync(filepath); } catch {}
                res.json({ success: true });
            });
        });
    });

    // Reorder images
    app.put('/api/shop/admin/products/:id/images/reorder', async (req, res) => {
        await auth({ required: true })(req, res, async () => {
            await requireAdmin(req, res, async () => {
                const { image_ids } = req.body || {};
                if (!Array.isArray(image_ids)) return res.error('image_ids array required');
                shop.reorderImages(parseInt(req.params.id), image_ids.map(Number));
                res.json({ success: true });
            });
        });
    });

    // ────────────────────────────────────────────
    // ADMIN: Option Groups & Values
    // ────────────────────────────────────────────

    app.post('/api/shop/admin/products/:id/options', async (req, res) => {
        await auth({ required: true })(req, res, async () => {
            await requireU2FAdmin(req, res, async () => {
                const product = shop.getProduct(parseInt(req.params.id));
                if (!product) return res.error('Product not found', 404);
                const { name } = req.body || {};
                if (!name || !name.trim()) return res.error('Option group name required');
                const group = shop.addOptionGroup(parseInt(req.params.id), sanitizeStr(name, 100));
                res.json({ group }, 201);
            });
        });
    });

    app.put('/api/shop/admin/options/:groupId', async (req, res) => {
        await auth({ required: true })(req, res, async () => {
            await requireAdmin(req, res, async () => {
                const { name } = req.body || {};
                if (!name || !name.trim()) return res.error('Name required');
                shop.updateOptionGroup(parseInt(req.params.groupId), sanitizeStr(name, 100));
                res.json({ success: true });
            });
        });
    });

    app.delete('/api/shop/admin/options/:groupId', async (req, res) => {
        await auth({ required: true })(req, res, async () => {
            await requireU2FAdmin(req, res, async () => {
                shop.deleteOptionGroup(parseInt(req.params.groupId));
                res.json({ success: true });
            });
        });
    });

    app.post('/api/shop/admin/options/:groupId/values', async (req, res) => {
        await auth({ required: true })(req, res, async () => {
            await requireU2FAdmin(req, res, async () => {
                const { label } = req.body || {};
                if (!label || !label.trim()) return res.error('Value label required');
                const value = shop.addOptionValue(parseInt(req.params.groupId), sanitizeStr(label, 100));
                res.json({ value }, 201);
            });
        });
    });

    app.delete('/api/shop/admin/values/:valueId', async (req, res) => {
        await auth({ required: true })(req, res, async () => {
            await requireU2FAdmin(req, res, async () => {
                shop.deleteOptionValue(parseInt(req.params.valueId));
                res.json({ success: true });
            });
        });
    });

    // ────────────────────────────────────────────
    // ADMIN: Variants
    // ────────────────────────────────────────────

    // Auto-generate all variant combinations
    app.post('/api/shop/admin/products/:id/variants/generate', async (req, res) => {
        await auth({ required: true })(req, res, async () => {
            await requireU2FAdmin(req, res, async () => {
                const product = shop.getProduct(parseInt(req.params.id));
                if (!product) return res.error('Product not found', 404);
                const created = shop.generateVariants(parseInt(req.params.id));
                res.json({ created: created.length, variants: created });
            });
        });
    });

    // Create single variant
    app.post('/api/shop/admin/products/:id/variants', async (req, res) => {
        await auth({ required: true })(req, res, async () => {
            await requireU2FAdmin(req, res, async () => {
                const product = shop.getProduct(parseInt(req.params.id));
                if (!product) return res.error('Product not found', 404);
                const { sku, price, stock, active, option_combo } = req.body || {};
                const variant = shop.createVariant(parseInt(req.params.id), {
                    sku, price: price != null ? parseFloat(price) : null,
                    stock: stock != null ? parseInt(stock) : -1,
                    active, option_combo
                });
                res.json({ variant }, 201);
            });
        });
    });

    // Update variant
    app.put('/api/shop/admin/variants/:variantId', async (req, res) => {
        await auth({ required: true })(req, res, async () => {
            await requireAdmin(req, res, async () => {
                const { sku, price, stock, active, option_combo } = req.body || {};
                shop.updateVariant(parseInt(req.params.variantId), {
                    sku, price: price !== undefined ? (price != null ? parseFloat(price) : null) : undefined,
                    stock: stock !== undefined ? parseInt(stock) : undefined,
                    active, option_combo
                });
                res.json({ success: true });
            });
        });
    });

    // Delete variant
    app.delete('/api/shop/admin/variants/:variantId', async (req, res) => {
        await auth({ required: true })(req, res, async () => {
            await requireU2FAdmin(req, res, async () => {
                shop.deleteVariant(parseInt(req.params.variantId));
                res.json({ success: true });
            });
        });
    });

    // ────────────────────────────────────────────
    // ADMIN: Orders
    // ────────────────────────────────────────────

    app.get('/api/shop/admin/orders', async (req, res) => {
        await auth({ required: true })(req, res, async () => {
            await requireAdmin(req, res, async () => {
                const status = req.query.status || undefined;
                const limit = Math.min(parseInt(req.query.limit) || 50, 200);
                const offset = parseInt(req.query.offset) || 0;
                const result = shop.listOrders({ status, limit, offset });
                const stats = shop.getOrderStats();
                res.json({ ...result, stats });
            });
        });
    });

    app.get('/api/shop/admin/orders/:id', async (req, res) => {
        await auth({ required: true })(req, res, async () => {
            await requireAdmin(req, res, async () => {
                const order = shop.getOrder(parseInt(req.params.id));
                if (!order) return res.error('Order not found', 404);
                res.json({ order });
            });
        });
    });

    app.put('/api/shop/admin/orders/:id/status', async (req, res) => {
        await auth({ required: true })(req, res, async () => {
            await requireU2FAdmin(req, res, async () => {
                const { status } = req.body || {};
                const order = shop.updateOrderStatus(parseInt(req.params.id), status);
                if (!order) return res.error('Invalid status', 400);
                res.json({ order });
            });
        });
    });

    // Shop stats for admin dashboard
    app.get('/api/shop/admin/stats', async (req, res) => {
        await auth({ required: true })(req, res, async () => {
            await requireAdmin(req, res, async () => {
                const stats = shop.getOrderStats();
                const products = shop.listProducts();
                stats.custom_products = products.length;
                res.json(stats);
            });
        });
    });
}

module.exports = { registerShopRoutes };
