/**
 * Shop Routes - Printful product catalog + Square payments
 */

const https = require('https');
const config = require('./config');

const PRINTFUL_API = 'https://api.printful.com';
const SQUARE_API = 'https://connect.squareup.com';

function printfulRequest(path) {
    return new Promise((resolve, reject) => {
        const url = new URL(path, PRINTFUL_API);
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
                    if (parsed.code === 200) {
                        resolve(parsed);
                    } else {
                        reject(new Error(parsed.result || 'Printful API error'));
                    }
                } catch (e) {
                    reject(new Error('Failed to parse Printful response'));
                }
            });
        });
        req.on('error', reject);
        req.setTimeout(10000, () => { req.destroy(); reject(new Error('Printful request timeout')); });
    });
}

function squareRequest(method, path, body) {
    return new Promise((resolve, reject) => {
        const url = new URL(path, SQUARE_API);
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
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(new Error('Failed to parse Square response'));
                }
            });
        });
        req.on('error', reject);
        req.setTimeout(15000, () => { req.destroy(); reject(new Error('Square request timeout')); });
        req.write(payload);
        req.end();
    });
}

function registerShopRoutes(app) {
    // Get shop config (public keys only)
    app.get('/api/shop/config', async (req, res) => {
        res.json({
            squareApplicationId: config.squareApplicationId,
            squareLocationId: config.squareLocationId,
            squareEnvironment: config.squareEnvironment
        });
    });

    // List products from Printful store
    app.get('/api/shop/products', async (req, res) => {
        if (!config.printfulApiToken) {
            return res.error('Shop not configured', 503);
        }
        try {
            const data = await printfulRequest('/store/products');
            const products = data.result || [];

            // Fetch details for each product (with variants)
            const detailed = await Promise.all(
                products.map(async (p) => {
                    try {
                        const detail = await printfulRequest(`/store/products/${p.id}`);
                        const sp = detail.result.sync_product;
                        const syncVariants = detail.result.sync_variants || [];
                        // Collect all images from first variant (same print across sizes)
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
                        const variants = syncVariants.map(sv => {
                            return {
                                id: sv.id,
                                name: sv.name,
                                size: sv.size,
                                color: sv.color,
                                retail_price: sv.retail_price,
                                currency: sv.currency || 'USD',
                                variant_id: sv.variant_id,
                                availability_status: sv.availability_status
                            };
                        });
                        return {
                            id: sp.id,
                            name: sp.name,
                            thumbnail_url: sp.thumbnail_url,
                            images,
                            variants
                        };
                    } catch {
                        return null;
                    }
                })
            );

            res.json({ products: detailed.filter(Boolean) });
        } catch (err) {
            console.error('Printful products error:', err.message);
            res.error('Failed to load products', 502);
        }
    });

    // Get single product details
    app.get('/api/shop/products/:id', async (req, res) => {
        if (!config.printfulApiToken) {
            return res.error('Shop not configured', 503);
        }
        try {
            const detail = await printfulRequest(`/store/products/${req.params.id}`);
            const sp = detail.result.sync_product;
            const syncVariants = detail.result.sync_variants || [];
            // Collect all images from first variant
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
            const variants = syncVariants.map(sv => {
                return {
                    id: sv.id,
                    name: sv.name,
                    size: sv.size,
                    color: sv.color,
                    retail_price: sv.retail_price,
                    currency: sv.currency || 'USD',
                    variant_id: sv.variant_id,
                    availability_status: sv.availability_status
                };
            });
            res.json({
                product: {
                    id: sp.id,
                    name: sp.name,
                    thumbnail_url: sp.thumbnail_url,
                    images,
                    variants
                }
            });
        } catch (err) {
            console.error('Printful product error:', err.message);
            res.error('Failed to load product', 502);
        }
    });

    // Create payment + Printful order
    app.post('/api/shop/checkout', async (req, res) => {
        if (!config.squareAccessToken || !config.printfulApiToken) {
            return res.error('Shop not configured', 503);
        }

        const { source_id, variant_id, quantity, shipping } = req.body || {};

        if (!source_id || !variant_id || !shipping) {
            return res.error('Missing required fields: source_id, variant_id, shipping', 400);
        }

        const qty = Math.min(Math.max(parseInt(quantity) || 1, 1), 10);

        // Validate shipping address
        if (!shipping.name || !shipping.address1 || !shipping.city ||
            !shipping.country_code || !shipping.zip) {
            return res.error('Incomplete shipping address', 400);
        }

        // Sanitize all string fields
        for (const key of Object.keys(shipping)) {
            if (typeof shipping[key] === 'string') {
                shipping[key] = shipping[key].trim().slice(0, 200);
            }
        }

        try {
            // 1. Look up variant price from Printful
            const variantData = await printfulRequest(`/store/variants/${variant_id}`);
            const variant = variantData.result;
            const price = parseFloat(variant.retail_price);
            if (!price || price <= 0) {
                return res.error('Invalid product price', 400);
            }

            const totalCents = Math.round(price * qty * 100);
            const idempotencyKey = `${Date.now()}-${variant_id}-${Math.random().toString(36).slice(2, 10)}`;

            // 2. Charge via Square
            const payment = await squareRequest('POST', '/v2/payments', {
                source_id,
                idempotency_key: idempotencyKey,
                amount_money: {
                    amount: totalCents,
                    currency: variant.currency || 'USD'
                },
                location_id: config.squareLocationId,
                note: `Rooted Revival: ${variant.name} x${qty}`
            });

            if (payment.errors) {
                const msg = payment.errors.map(e => e.detail).join('; ');
                console.error('Square payment error:', msg);
                return res.error(`Payment failed: ${msg}`, 402);
            }

            const paymentId = payment.payment?.id;

            // 3. Create Printful order (draft — auto-confirm with Printful billing)
            const pfOrderBody = {
                recipient: {
                    name: shipping.name,
                    address1: shipping.address1,
                    address2: shipping.address2 || '',
                    city: shipping.city,
                    state_code: shipping.state_code || '',
                    country_code: shipping.country_code,
                    zip: shipping.zip,
                    email: shipping.email || ''
                },
                items: [{
                    sync_variant_id: variant_id,
                    quantity: qty
                }],
                retail_costs: {
                    subtotal: (price * qty).toFixed(2),
                    total: (price * qty).toFixed(2)
                }
            };

            const pfUrl = new URL('/orders?confirm=true', PRINTFUL_API);
            const pfOrder = await new Promise((resolve, reject) => {
                const payload = JSON.stringify(pfOrderBody);
                const pfReq = https.request(pfUrl, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${config.printfulApiToken}`,
                        'Content-Type': 'application/json',
                        'Content-Length': Buffer.byteLength(payload)
                    }
                }, (pfRes) => {
                    let data = '';
                    pfRes.on('data', chunk => data += chunk);
                    pfRes.on('end', () => {
                        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
                    });
                });
                pfReq.on('error', reject);
                pfReq.setTimeout(20000, () => { pfReq.destroy(); reject(new Error('Printful order timeout')); });
                pfReq.write(payload);
                pfReq.end();
            });

            if (pfOrder.code !== 200) {
                console.error('Printful order error:', pfOrder.result || pfOrder.error);
                // Payment succeeded but order failed — log for manual resolution
                console.error(`ALERT: Payment ${paymentId} succeeded but Printful order failed. Variant: ${variant_id}, Qty: ${qty}`);
                return res.json({
                    success: true,
                    payment_id: paymentId,
                    order_warning: 'Payment processed. Order is being fulfilled manually — you will receive a confirmation email.',
                    amount: (price * qty).toFixed(2)
                });
            }

            res.json({
                success: true,
                payment_id: paymentId,
                order_id: pfOrder.result?.id,
                order_status: pfOrder.result?.status,
                amount: (price * qty).toFixed(2),
                message: 'Order placed successfully! You will receive shipping updates via email.'
            });

        } catch (err) {
            console.error('Checkout error:', err.message);
            res.error('Checkout failed — please try again', 500);
        }
    });

    // Estimate shipping (optional)
    app.post('/api/shop/shipping-estimate', async (req, res) => {
        if (!config.printfulApiToken) {
            return res.error('Shop not configured', 503);
        }

        const { variant_id, quantity, address } = req.body || {};
        if (!variant_id || !address || !address.country_code) {
            return res.error('Missing variant_id or address', 400);
        }

        try {
            const body = {
                recipient: {
                    country_code: address.country_code,
                    state_code: address.state_code || '',
                    city: address.city || '',
                    zip: address.zip || ''
                },
                items: [{
                    variant_id: String(variant_id),
                    quantity: parseInt(quantity) || 1
                }]
            };

            const url = new URL('/shipping/rates', PRINTFUL_API);
            const rates = await new Promise((resolve, reject) => {
                const payload = JSON.stringify(body);
                const req = https.request(url, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${config.printfulApiToken}`,
                        'Content-Type': 'application/json',
                        'Content-Length': Buffer.byteLength(payload)
                    }
                }, (r) => {
                    let data = '';
                    r.on('data', chunk => data += chunk);
                    r.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
                });
                req.on('error', reject);
                req.write(payload);
                req.end();
            });

            if (rates.code === 200) {
                res.json({ rates: rates.result });
            } else {
                res.error('Could not estimate shipping', 502);
            }
        } catch (err) {
            console.error('Shipping estimate error:', err.message);
            res.error('Shipping estimate failed', 500);
        }
    });
}

module.exports = { registerShopRoutes };
