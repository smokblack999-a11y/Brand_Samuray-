FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY server.js ./
RUN mkdir -p /data && chown -R node:node /app /data
EXPOSE 8080
USER node
CMD ["node","server.js"]