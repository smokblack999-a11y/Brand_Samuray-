FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /opt/samurai-messenger

COPY service/package.json ./package.json
RUN npm install --omit=dev --ignore-scripts --no-audit --no-fund

COPY service/src ./src
USER node
EXPOSE 8790
CMD ["node", "src/server.js"]
