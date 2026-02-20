# Build stage
FROM node:20-slim AS builder

# Upgrade OS packages to pick up security patches (e.g. gnutls28 CVE fix)
RUN apt-get update && apt-get upgrade -y && rm -rf /var/lib/apt/lists/*

# Upgrade npm to fix CVE in bundled tar (<=7.5.3)
RUN npm install -g npm@latest

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (skip prepare script, will build after copying source)
RUN npm ci --ignore-scripts

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# Production stage
FROM node:20-slim

# Upgrade OS packages to pick up security patches (e.g. gnutls28 CVE fix)
RUN apt-get update && apt-get upgrade -y && rm -rf /var/lib/apt/lists/*

# Upgrade npm to fix CVE in bundled tar (<=7.5.3)
RUN npm install -g npm@latest

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies (skip scripts since we're copying pre-built files)
RUN npm ci --omit=dev --ignore-scripts

# Copy built files from builder
COPY --from=builder /app/dist ./dist

# Expose the port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3001/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start the server
CMD ["node", "dist/index.js"]
