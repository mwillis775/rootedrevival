FROM node:20-alpine

# Create app directory
WORKDIR /app

# Install dependencies first (for caching)
COPY package*.json ./
RUN npm ci --only=production

# Copy application code
COPY . .

# Create data directories
RUN mkdir -p data/uploads

# Initialize database
RUN npm run db:init

# Create non-root user
RUN addgroup -S scholar && adduser -S scholar -G scholar
RUN chown -R scholar:scholar /app
USER scholar

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

# Start server
CMD ["node", "src/index.js"]
