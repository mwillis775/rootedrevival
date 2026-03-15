# Build stage for Scholar
FROM rust:1-bookworm AS scholar-builder

WORKDIR /build

# Copy GrabNet source (dependency)
COPY grab/ ./grab/

# Copy Scholar source
COPY scholar/ ./scholar/

# Build Scholar in release mode
WORKDIR /build/scholar
RUN cargo build --release

# Build stage for GrabNet
FROM rust:1-bookworm AS grabnet-builder

WORKDIR /build
COPY grab/ ./grab/

WORKDIR /build/grab
RUN cargo build --release

# Runtime stage
FROM debian:bookworm-slim

# Install runtime dependencies
RUN apt-get update && apt-get install -y \
    ca-certificates \
    libssl3 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN useradd -m -s /bin/bash scholar

# Create data directories
RUN mkdir -p /data/scholar /data/grabnet \
    && chown -R scholar:scholar /data

# Copy binaries
COPY --from=scholar-builder /build/scholar/target/release/scholar /usr/local/bin/
COPY --from=grabnet-builder /build/grab/target/release/grab /usr/local/bin/

# Copy static files (if they exist in the build)
# These are typically created at runtime in ~/.local/share/scholar/static

USER scholar
WORKDIR /home/scholar

# Environment variables
ENV SCHOLAR_DATA_DIR=/data/scholar
ENV GRAB_DATA_DIR=/data/grabnet
ENV RUST_LOG=info

# Expose ports
EXPOSE 8889 8080 4001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8889/api/health || exit 1

# Default command: run Scholar (GrabNet auto-starts)
CMD ["scholar", "--port", "8889"]
