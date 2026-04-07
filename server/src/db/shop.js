/**
 * Rooted Revival - Shop Database Module
 *
 * Custom product management, variants, option groups, images, and order tracking.
 * Printful products are fetched live from API; this module handles locally-managed products.
 */

const { getDb, generateUuid } = require('./index');

function slugify(name) {
    return String(name).toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80) || 'product';
}

function initShopTables() {
    const db = getDb();
    db.exec(`
        CREATE TABLE IF NOT EXISTS custom_products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            slug TEXT UNIQUE NOT NULL,
            description TEXT DEFAULT '',
            base_price REAL NOT NULL DEFAULT 0,
            active INTEGER DEFAULT 1,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS custom_product_option_groups (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_id INTEGER NOT NULL REFERENCES custom_products(id) ON DELETE CASCADE,
            name TEXT NOT NULL,
            sort_order INTEGER DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_cpog_product ON custom_product_option_groups(product_id);

        CREATE TABLE IF NOT EXISTS custom_product_option_values (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            group_id INTEGER NOT NULL REFERENCES custom_product_option_groups(id) ON DELETE CASCADE,
            label TEXT NOT NULL,
            sort_order INTEGER DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_cpov_group ON custom_product_option_values(group_id);

        CREATE TABLE IF NOT EXISTS custom_product_images (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_id INTEGER NOT NULL REFERENCES custom_products(id) ON DELETE CASCADE,
            filename TEXT NOT NULL,
            original_filename TEXT,
            mime_type TEXT,
            file_size INTEGER DEFAULT 0,
            sort_order INTEGER DEFAULT 0,
            option_value_id INTEGER DEFAULT NULL REFERENCES custom_product_option_values(id) ON DELETE SET NULL
        );
        CREATE INDEX IF NOT EXISTS idx_cpi_product ON custom_product_images(product_id);

        CREATE TABLE IF NOT EXISTS custom_product_variants (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_id INTEGER NOT NULL REFERENCES custom_products(id) ON DELETE CASCADE,
            sku TEXT,
            price REAL,
            stock INTEGER DEFAULT -1,
            active INTEGER DEFAULT 1,
            option_combo TEXT NOT NULL DEFAULT '[]',
            created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_cpv_product ON custom_product_variants(product_id);

        CREATE TABLE IF NOT EXISTS shop_orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_number TEXT UNIQUE NOT NULL,
            status TEXT DEFAULT 'pending',
            payment_id TEXT,
            billing_name TEXT NOT NULL,
            billing_email TEXT,
            billing_address1 TEXT NOT NULL,
            billing_address2 TEXT,
            billing_city TEXT NOT NULL,
            billing_state TEXT,
            billing_zip TEXT NOT NULL,
            billing_country TEXT NOT NULL DEFAULT 'US',
            shipping_name TEXT NOT NULL,
            shipping_email TEXT,
            shipping_address1 TEXT NOT NULL,
            shipping_address2 TEXT,
            shipping_city TEXT NOT NULL,
            shipping_state TEXT,
            shipping_zip TEXT NOT NULL,
            shipping_country TEXT NOT NULL DEFAULT 'US',
            subtotal REAL NOT NULL DEFAULT 0,
            shipping_cost REAL DEFAULT 0,
            total REAL NOT NULL DEFAULT 0,
            notes TEXT,
            has_printful_items INTEGER DEFAULT 0,
            printful_order_id TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS shop_order_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_id INTEGER NOT NULL REFERENCES shop_orders(id) ON DELETE CASCADE,
            product_name TEXT NOT NULL,
            variant_desc TEXT,
            price REAL NOT NULL,
            quantity INTEGER NOT NULL DEFAULT 1,
            source TEXT DEFAULT 'custom',
            source_variant_id INTEGER,
            source_product_id INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_soi_order ON shop_order_items(order_id);

        CREATE TABLE IF NOT EXISTS product_display_order (
            product_key TEXT PRIMARY KEY,
            sort_order INTEGER NOT NULL DEFAULT 0
        );
    `);
}

// ========== PRODUCTS ==========

function createProduct({ name, description, base_price }) {
    const db = getDb();
    let slug = slugify(name);
    const existing = db.prepare('SELECT id FROM custom_products WHERE slug = ?').get(slug);
    if (existing) slug += '-' + Date.now().toString(36);
    const result = db.prepare(
        'INSERT INTO custom_products (name, slug, description, base_price) VALUES (?, ?, ?, ?)'
    ).run(name, slug, description || '', parseFloat(base_price) || 0);
    return getProduct(result.lastInsertRowid);
}

function updateProduct(id, { name, description, base_price, active }) {
    const db = getDb();
    const sets = [];
    const params = [];
    if (name !== undefined) { sets.push('name = ?'); params.push(name); }
    if (description !== undefined) { sets.push('description = ?'); params.push(description); }
    if (base_price !== undefined) { sets.push('base_price = ?'); params.push(parseFloat(base_price) || 0); }
    if (active !== undefined) { sets.push('active = ?'); params.push(active ? 1 : 0); }
    if (!sets.length) return getProduct(id);
    sets.push("updated_at = datetime('now')");
    params.push(id);
    db.prepare(`UPDATE custom_products SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    return getProduct(id);
}

function deleteProduct(id) {
    const db = getDb();
    return db.prepare('DELETE FROM custom_products WHERE id = ?').run(id).changes > 0;
}

function getProduct(id) {
    const db = getDb();
    const product = db.prepare('SELECT * FROM custom_products WHERE id = ?').get(id);
    if (!product) return null;
    product.images = db.prepare(
        'SELECT * FROM custom_product_images WHERE product_id = ? ORDER BY sort_order, id'
    ).all(id);
    product.option_groups = db.prepare(
        'SELECT * FROM custom_product_option_groups WHERE product_id = ? ORDER BY sort_order, id'
    ).all(id);
    for (const group of product.option_groups) {
        group.values = db.prepare(
            'SELECT * FROM custom_product_option_values WHERE group_id = ? ORDER BY sort_order, id'
        ).all(group.id);
    }
    product.variants = db.prepare(
        'SELECT * FROM custom_product_variants WHERE product_id = ? ORDER BY id'
    ).all(id);
    for (const v of product.variants) {
        try { v.option_combo = JSON.parse(v.option_combo); } catch { v.option_combo = []; }
    }
    return product;
}

function listProducts({ activeOnly = false } = {}) {
    const db = getDb();
    const where = activeOnly ? 'WHERE active = 1' : '';
    const products = db.prepare(`SELECT * FROM custom_products ${where} ORDER BY created_at DESC`).all();
    for (const p of products) {
        p.images = db.prepare(
            'SELECT * FROM custom_product_images WHERE product_id = ? ORDER BY sort_order, id'
        ).all(p.id);
        p.option_groups = db.prepare(
            'SELECT * FROM custom_product_option_groups WHERE product_id = ? ORDER BY sort_order, id'
        ).all(p.id);
        for (const g of p.option_groups) {
            g.values = db.prepare(
                'SELECT * FROM custom_product_option_values WHERE group_id = ? ORDER BY sort_order, id'
            ).all(g.id);
        }
        p.variants = db.prepare(
            'SELECT * FROM custom_product_variants WHERE product_id = ? ORDER BY id'
        ).all(p.id);
        for (const v of p.variants) {
            try { v.option_combo = JSON.parse(v.option_combo); } catch { v.option_combo = []; }
        }
    }
    return products;
}

// ========== IMAGES ==========

function addProductImage(productId, { filename, originalFilename, mimeType, fileSize, sortOrder, optionValueId }) {
    const db = getDb();
    const maxOrder = db.prepare(
        'SELECT MAX(sort_order) as m FROM custom_product_images WHERE product_id = ?'
    ).get(productId);
    const result = db.prepare(
        'INSERT INTO custom_product_images (product_id, filename, original_filename, mime_type, file_size, sort_order, option_value_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(productId, filename, originalFilename || '', mimeType || '', fileSize || 0, sortOrder ?? ((maxOrder?.m || 0) + 1), optionValueId || null);
    return db.prepare('SELECT * FROM custom_product_images WHERE id = ?').get(result.lastInsertRowid);
}

function deleteProductImage(id) {
    const db = getDb();
    const img = db.prepare('SELECT * FROM custom_product_images WHERE id = ?').get(id);
    if (!img) return null;
    db.prepare('DELETE FROM custom_product_images WHERE id = ?').run(id);
    return img;
}

function updateImageOptionValue(imageId, optionValueId) {
    const db = getDb();
    db.prepare('UPDATE custom_product_images SET option_value_id = ? WHERE id = ?').run(optionValueId || null, imageId);
}

function reorderImages(productId, imageIds) {
    const db = getDb();
    const stmt = db.prepare('UPDATE custom_product_images SET sort_order = ? WHERE id = ? AND product_id = ?');
    imageIds.forEach((id, i) => stmt.run(i, id, productId));
}

// ========== OPTION GROUPS & VALUES ==========

function addOptionGroup(productId, name) {
    const db = getDb();
    const maxOrder = db.prepare(
        'SELECT MAX(sort_order) as m FROM custom_product_option_groups WHERE product_id = ?'
    ).get(productId);
    const result = db.prepare(
        'INSERT INTO custom_product_option_groups (product_id, name, sort_order) VALUES (?, ?, ?)'
    ).run(productId, name, (maxOrder?.m || 0) + 1);
    return { id: result.lastInsertRowid, product_id: productId, name, sort_order: (maxOrder?.m || 0) + 1, values: [] };
}

function updateOptionGroup(id, name) {
    const db = getDb();
    db.prepare('UPDATE custom_product_option_groups SET name = ? WHERE id = ?').run(name, id);
}

function deleteOptionGroup(id) {
    const db = getDb();
    return db.prepare('DELETE FROM custom_product_option_groups WHERE id = ?').run(id).changes > 0;
}

function addOptionValue(groupId, label) {
    const db = getDb();
    const maxOrder = db.prepare(
        'SELECT MAX(sort_order) as m FROM custom_product_option_values WHERE group_id = ?'
    ).get(groupId);
    const result = db.prepare(
        'INSERT INTO custom_product_option_values (group_id, label, sort_order) VALUES (?, ?, ?)'
    ).run(groupId, label, (maxOrder?.m || 0) + 1);
    return { id: result.lastInsertRowid, group_id: groupId, label, sort_order: (maxOrder?.m || 0) + 1 };
}

function deleteOptionValue(id) {
    const db = getDb();
    db.prepare('UPDATE custom_product_images SET option_value_id = NULL WHERE option_value_id = ?').run(id);
    return db.prepare('DELETE FROM custom_product_option_values WHERE id = ?').run(id).changes > 0;
}

// ========== VARIANTS ==========

function createVariant(productId, { sku, price, stock, active, option_combo }) {
    const db = getDb();
    const combo = JSON.stringify(option_combo || []);
    const result = db.prepare(
        'INSERT INTO custom_product_variants (product_id, sku, price, stock, active, option_combo) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(productId, sku || null, price ?? null, stock ?? -1, active !== undefined ? (active ? 1 : 0) : 1, combo);
    const v = db.prepare('SELECT * FROM custom_product_variants WHERE id = ?').get(result.lastInsertRowid);
    try { v.option_combo = JSON.parse(v.option_combo); } catch { v.option_combo = []; }
    return v;
}

function updateVariant(id, { sku, price, stock, active, option_combo }) {
    const db = getDb();
    const sets = [];
    const params = [];
    if (sku !== undefined) { sets.push('sku = ?'); params.push(sku); }
    if (price !== undefined) { sets.push('price = ?'); params.push(price); }
    if (stock !== undefined) { sets.push('stock = ?'); params.push(stock); }
    if (active !== undefined) { sets.push('active = ?'); params.push(active ? 1 : 0); }
    if (option_combo !== undefined) { sets.push('option_combo = ?'); params.push(JSON.stringify(option_combo)); }
    if (!sets.length) return;
    params.push(id);
    db.prepare(`UPDATE custom_product_variants SET ${sets.join(', ')} WHERE id = ?`).run(...params);
}

function deleteVariant(id) {
    const db = getDb();
    return db.prepare('DELETE FROM custom_product_variants WHERE id = ?').run(id).changes > 0;
}

function generateVariants(productId) {
    const product = getProduct(productId);
    if (!product) return [];

    const groups = product.option_groups.filter(g => g.values.length > 0);
    if (!groups.length) return [];

    function cartesian(arrays) {
        return arrays.reduce((acc, arr) =>
            acc.flatMap(combo => arr.map(item => [...combo, item])),
            [[]]
        );
    }

    const valueSets = groups.map(g => g.values.map(v => ({
        group_id: g.id, group_name: g.name, value_id: v.id, value_label: v.label
    })));
    const combos = cartesian(valueSets);

    const existing = product.variants.map(v => JSON.stringify(
        (v.option_combo || []).map(c => c.group_id + ':' + c.value_id).sort()
    ));

    const created = [];
    for (const combo of combos) {
        const key = JSON.stringify(combo.map(c => c.group_id + ':' + c.value_id).sort());
        if (existing.includes(key)) continue;

        const v = createVariant(productId, {
            option_combo: combo.map(c => ({
                group_id: c.group_id,
                group_name: c.group_name,
                value_id: c.value_id,
                value_label: c.value_label
            })),
            price: null,
            stock: -1,
            active: true
        });
        created.push(v);
    }
    return created;
}

// ========== ORDERS ==========

function generateOrderNumber() {
    const now = new Date();
    const y = now.getFullYear().toString().slice(-2);
    const m = (now.getMonth() + 1).toString().padStart(2, '0');
    const d = now.getDate().toString().padStart(2, '0');
    const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
    return `RR-${y}${m}${d}-${rand}`;
}

function createOrder({ payment_id, billing, shipping, items, subtotal, shipping_cost, total, has_printful_items, printful_order_id, notes }) {
    const db = getDb();
    const orderNumber = generateOrderNumber();
    const result = db.prepare(`
        INSERT INTO shop_orders (order_number, payment_id,
            billing_name, billing_email, billing_address1, billing_address2, billing_city, billing_state, billing_zip, billing_country,
            shipping_name, shipping_email, shipping_address1, shipping_address2, shipping_city, shipping_state, shipping_zip, shipping_country,
            subtotal, shipping_cost, total, has_printful_items, printful_order_id, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        orderNumber, payment_id || null,
        billing.name, billing.email || null, billing.address1, billing.address2 || null, billing.city, billing.state || null, billing.zip, billing.country || 'US',
        shipping.name, shipping.email || null, shipping.address1, shipping.address2 || null, shipping.city, shipping.state || null, shipping.zip, shipping.country || 'US',
        subtotal || 0, shipping_cost || 0, total || 0,
        has_printful_items ? 1 : 0, printful_order_id || null, notes || null
    );

    const orderId = result.lastInsertRowid;
    const insertItem = db.prepare(
        'INSERT INTO shop_order_items (order_id, product_name, variant_desc, price, quantity, source, source_variant_id, source_product_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    );
    for (const item of items) {
        insertItem.run(orderId, item.product_name, item.variant_desc || null, item.price, item.quantity || 1, item.source || 'custom', item.source_variant_id || null, item.source_product_id || null);
    }

    return getOrder(orderId);
}

function getOrder(id) {
    const db = getDb();
    const order = db.prepare('SELECT * FROM shop_orders WHERE id = ?').get(id);
    if (!order) return null;
    order.items = db.prepare('SELECT * FROM shop_order_items WHERE order_id = ?').all(id);
    return order;
}

function getOrderByNumber(orderNumber) {
    const db = getDb();
    const order = db.prepare('SELECT * FROM shop_orders WHERE order_number = ?').get(orderNumber);
    if (!order) return null;
    order.items = db.prepare('SELECT * FROM shop_order_items WHERE order_id = ?').all(order.id);
    return order;
}

function listOrders({ status, limit = 50, offset = 0 } = {}) {
    const db = getDb();
    let where = '';
    const params = [];
    if (status) { where = 'WHERE status = ?'; params.push(status); }
    const countParams = [...params];
    params.push(limit, offset);
    const orders = db.prepare(`SELECT * FROM shop_orders ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params);
    const total = db.prepare(`SELECT COUNT(*) as count FROM shop_orders ${where}`).get(...countParams);
    return { orders, total: total.count };
}

function updateOrderStatus(id, status) {
    const db = getDb();
    const valid = ['pending', 'processing', 'shipped', 'delivered', 'cancelled'];
    if (!valid.includes(status)) return false;
    db.prepare("UPDATE shop_orders SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, id);
    return getOrder(id);
}

function getOrderStats() {
    const db = getDb();
    const total = db.prepare('SELECT COUNT(*) as c FROM shop_orders').get().c;
    const pending = db.prepare("SELECT COUNT(*) as c FROM shop_orders WHERE status = 'pending'").get().c;
    const revenue = db.prepare('SELECT COALESCE(SUM(total), 0) as r FROM shop_orders WHERE status != ?').get('cancelled').r;
    return { total, pending, revenue };
}

// ========== Product Display Order ==========

function getDisplayOrder() {
    const db = getDb();
    return db.prepare('SELECT product_key, sort_order FROM product_display_order ORDER BY sort_order').all();
}

function setDisplayOrder(orderedKeys) {
    const db = getDb();
    const upsert = db.prepare(
        'INSERT INTO product_display_order (product_key, sort_order) VALUES (?, ?) ON CONFLICT(product_key) DO UPDATE SET sort_order = excluded.sort_order'
    );
    const run = db.transaction((keys) => {
        for (let i = 0; i < keys.length; i++) {
            upsert.run(String(keys[i]), i);
        }
    });
    run(orderedKeys);
}

module.exports = {
    initShopTables,
    slugify,
    createProduct, updateProduct, deleteProduct, getProduct, listProducts,
    addProductImage, deleteProductImage, updateImageOptionValue, reorderImages,
    addOptionGroup, updateOptionGroup, deleteOptionGroup,
    addOptionValue, deleteOptionValue,
    createVariant, updateVariant, deleteVariant, generateVariants,
    createOrder, getOrder, getOrderByNumber, listOrders, updateOrderStatus, getOrderStats,
    getDisplayOrder, setDisplayOrder
};
