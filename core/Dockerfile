FROM node:22-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8787

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .
RUN mkdir -p /app/data && chown -R node:node /app
USER node

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:8787/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node","server.js"]
