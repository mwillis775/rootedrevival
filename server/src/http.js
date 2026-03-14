/**
 * OpenSource Scholar - HTTP Server & Router
 * 
 * Pure Node.js HTTP server with routing, middleware, and request handling.
 * No external frameworks required.
 */

const http = require('http');
const { URL } = require('url');
const cookie = require('cookie');
const config = require('./config');

function resolveCorsOrigin(requestOrigin, configuredOrigin) {
    if (!requestOrigin) {
        return configuredOrigin === '*' ? '*' : configuredOrigin;
    }

    try {
        const originUrl = new URL(requestOrigin);
        const host = originUrl.hostname;
        const explicitOrigins = new Set([
            new URL(config.baseUrl).origin,
            'https://rootedrevival.us',
            'https://scholar.rootedrevival.us',
            'http://localhost:3000',
            'http://localhost:8080',
            'http://127.0.0.1:3000',
            'http://127.0.0.1:8080'
        ]);

        if (explicitOrigins.has(originUrl.origin)) {
            return originUrl.origin;
        }

        if (host === 'rootedrevival.us' || host.endsWith('.rootedrevival.us')) {
            return originUrl.origin;
        }
    } catch (error) {
        return configuredOrigin === '*' ? '*' : configuredOrigin;
    }

    return configuredOrigin === '*' ? new URL(config.baseUrl).origin : configuredOrigin;
}

/**
 * Simple router class
 */
class Router {
    constructor() {
        this.routes = {
            GET: [],
            POST: [],
            PUT: [],
            DELETE: [],
            PATCH: []
        };
        this.middleware = [];
    }
    
    use(fn) {
        this.middleware.push(fn);
    }
    
    addRoute(method, pattern, ...args) {
        // Support both (pattern, handler) and (pattern, middleware..., handler)
        const handler = args.pop();
        const middleware = args;
        
        const regex = pattern instanceof RegExp 
            ? pattern 
            : this.pathToRegex(pattern);
        
        this.routes[method].push({ pattern, regex, handler, middleware });
    }
    
    get(pattern, ...args) { this.addRoute('GET', pattern, ...args); }
    post(pattern, ...args) { this.addRoute('POST', pattern, ...args); }
    put(pattern, ...args) { this.addRoute('PUT', pattern, ...args); }
    delete(pattern, ...args) { this.addRoute('DELETE', pattern, ...args); }
    patch(pattern, ...args) { this.addRoute('PATCH', pattern, ...args); }
    
    pathToRegex(path) {
        // Convert /path/:param/other to regex with named groups
        const pattern = path
            .replace(/\//g, '\\/')
            .replace(/:([a-zA-Z0-9_]+)/g, '(?<$1>[^/]+)');
        
        return new RegExp(`^${pattern}$`);
    }
    
    match(method, pathname) {
        const routes = this.routes[method] || [];
        
        for (const route of routes) {
            const match = pathname.match(route.regex);
            if (match) {
                return {
                    handler: route.handler,
                    middleware: route.middleware || [],
                    params: match.groups || {}
                };
            }
        }
        
        return null;
    }
}

/**
 * Enhanced request object
 */
function enhanceRequest(req) {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    
    req.pathname = url.pathname;
    req.query = Object.fromEntries(url.searchParams);
    req.cookies = cookie.parse(req.headers.cookie || '');
    req.params = {};
    req.body = null;
    req.user = null;
    req.u2fVerified = false;
    
    return req;
}

/**
 * Enhanced response object with helpers
 */
function enhanceResponse(res) {
    res.json = (data, status = 200) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
    };
    
    res.text = (data, status = 200) => {
        res.writeHead(status, { 'Content-Type': 'text/plain' });
        res.end(data);
    };
    
    res.html = (data, status = 200) => {
        res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(data);
    };
    
    res.redirect = (url, status = 302) => {
        res.writeHead(status, { 'Location': url });
        res.end();
    };
    
    res.setCookie = (name, value, options = {}) => {
        const defaults = {
            httpOnly: true,
            secure: config.baseUrl.startsWith('https'),
            sameSite: 'Lax',
            path: '/',
            maxAge: config.sessionMaxAge / 1000
        };
        
        const cookieStr = cookie.serialize(name, value, { ...defaults, ...options });
        
        const existing = res.getHeader('Set-Cookie') || [];
        const cookies = Array.isArray(existing) ? existing : [existing];
        cookies.push(cookieStr);
        
        res.setHeader('Set-Cookie', cookies);
    };
    
    res.clearCookie = (name) => {
        res.setCookie(name, '', { maxAge: 0 });
    };
    
    res.error = (message, status = 400) => {
        res.json({ error: message }, status);
    };
    
    return res;
}

/**
 * Parse JSON body
 */
function parseJsonBody(req) {
    return new Promise((resolve, reject) => {
        const contentType = req.headers['content-type'] || '';
        
        if (!contentType.includes('application/json')) {
            return resolve(null);
        }
        
        let body = '';
        
        req.on('data', chunk => {
            body += chunk;
            
            // Limit body size
            if (body.length > 10 * 1024 * 1024) {
                reject(new Error('Request body too large'));
            }
        });
        
        req.on('end', () => {
            try {
                resolve(body ? JSON.parse(body) : null);
            } catch (e) {
                reject(new Error('Invalid JSON'));
            }
        });
        
        req.on('error', reject);
    });
}

/**
 * Parse multipart form data (for file uploads)
 */
function parseMultipart(req, options = {}) {
    return new Promise((resolve, reject) => {
        const Busboy = require('busboy');
        const contentType = req.headers['content-type'] || '';
        
        if (!contentType.includes('multipart/form-data')) {
            return resolve({ fields: {}, files: [] });
        }
        
        const busboy = Busboy({
            headers: req.headers,
            limits: {
                fileSize: options.maxFileSize || config.maxFileSize,
                files: options.maxFiles || 10
            }
        });
        
        const fields = {};
        const files = [];
        
        busboy.on('field', (name, value) => {
            fields[name] = value;
        });
        
        busboy.on('file', (name, file, info) => {
            const { filename, encoding, mimeType } = info;
            const chunks = [];
            
            file.on('data', chunk => {
                chunks.push(chunk);
            });
            
            file.on('end', () => {
                files.push({
                    fieldname: name,
                    filename,
                    encoding,
                    mimeType,
                    buffer: Buffer.concat(chunks),
                    size: Buffer.concat(chunks).length
                });
            });
        });
        
        busboy.on('finish', () => {
            resolve({ fields, files });
        });
        
        busboy.on('error', reject);
        
        req.pipe(busboy);
    });
}

/**
 * CORS middleware
 */
function cors(options = {}) {
    const defaults = {
        origin: '*',
        methods: 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
        headers: 'Content-Type, Authorization',
        credentials: true
    };
    
    const opts = { ...defaults, ...options };
    
    return async (req, res, next) => {
        const allowOrigin = resolveCorsOrigin(req.headers.origin, opts.origin);

        res.setHeader('Access-Control-Allow-Origin', allowOrigin);
        res.setHeader('Access-Control-Allow-Methods', opts.methods);
        res.setHeader('Access-Control-Allow-Headers', opts.headers);
        res.setHeader('Vary', 'Origin');
        
        if (opts.credentials) {
            res.setHeader('Access-Control-Allow-Credentials', 'true');
        }
        
        // Handle preflight
        if (req.method === 'OPTIONS') {
            res.writeHead(204);
            res.end();
            return;
        }
        
        await next();
    };
}

/**
 * Authentication middleware
 */
function auth(options = { required: true }) {
    const users = require('./db/users');
    
    return async (req, res, next) => {
        const token = req.cookies.session || 
                      req.headers.authorization?.replace('Bearer ', '');
        
        if (token) {
            const session = users.validateSession(token);
            if (session) {
                req.user = session.user;
                req.sessionId = session.sessionId;
                req.u2fVerified = req.cookies.u2f_verified === 'true';
            }
        }
        
        if (options.required && !req.user) {
            return res.error('Authentication required', 401);
        }
        
        await next();
    };
}

/**
 * Rate limiting (simple in-memory)
 */
const rateLimitStore = new Map();

function rateLimit(limit, windowMs = 60000) {
    return async (req, res, next) => {
        const key = req.socket.remoteAddress;
        const now = Date.now();
        
        let record = rateLimitStore.get(key);
        
        if (!record || now - record.start > windowMs) {
            record = { start: now, count: 0 };
            rateLimitStore.set(key, record);
        }
        
        record.count++;
        
        if (record.count > limit) {
            res.setHeader('Retry-After', Math.ceil((record.start + windowMs - now) / 1000));
            return res.error('Too many requests', 429);
        }
        
        await next();
    };
}

/**
 * Create the application
 */
function createApp() {
    const router = new Router();
    
    async function handleRequest(req, res) {
        enhanceRequest(req);
        enhanceResponse(res);
        
        try {
            // Run middleware
            let middlewareIndex = 0;
            
            const runMiddleware = async () => {
                if (middlewareIndex < router.middleware.length) {
                    const mw = router.middleware[middlewareIndex++];
                    await mw(req, res, runMiddleware);
                }
            };
            
            await runMiddleware();
            
            // If response already sent by middleware, stop
            if (res.writableEnded) return;
            
            // Parse body for POST/PUT/PATCH
            if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
                const contentType = req.headers['content-type'] || '';
                
                if (contentType.includes('multipart/form-data')) {
                    const { fields, files } = await parseMultipart(req);
                    req.body = fields;
                    req.files = files;
                } else {
                    req.body = await parseJsonBody(req);
                }
            }
            
            // Find route
            const match = router.match(req.method, req.pathname);
            
            if (match) {
                req.params = match.params;
                
                // Run route-level middleware
                let middlewareIndex = 0;
                const routeMiddleware = match.middleware;
                
                const runRouteMiddleware = async () => {
                    if (middlewareIndex < routeMiddleware.length) {
                        const mw = routeMiddleware[middlewareIndex++];
                        await mw(req, res, runRouteMiddleware);
                    } else {
                        // All middleware passed, run handler
                        await match.handler(req, res);
                    }
                };
                
                await runRouteMiddleware();
            } else {
                res.error('Not found', 404);
            }
            
        } catch (error) {
            console.error('Request error:', error);
            
            if (!res.writableEnded) {
                res.error(error.message || 'Internal server error', 500);
            }
        }
    }
    
    const server = http.createServer(handleRequest);
    
    return {
        router,
        server,
        use: (fn) => router.use(fn),
        get: (...args) => router.get(...args),
        post: (...args) => router.post(...args),
        put: (...args) => router.put(...args),
        delete: (...args) => router.delete(...args),
        patch: (...args) => router.patch(...args),
        listen: (port, callback) => server.listen(port, callback)
    };
}

module.exports = {
    createApp,
    Router,
    cors,
    auth,
    rateLimit,
    parseJsonBody,
    parseMultipart
};
