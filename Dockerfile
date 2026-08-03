FROM node:24-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d AS build

WORKDIR /app
COPY package.json package-lock.json* ./
COPY vendor/open-node/package.json vendor/open-node/package-lock.json vendor/open-node/tsconfig.json vendor/open-node/
COPY vendor/open-node/packages vendor/open-node/packages
RUN npm ci

COPY index.html tsconfig.json vite.config.ts ./
COPY src src
RUN npm run build
RUN npm prune --omit=dev

FROM node:24-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d AS runtime

ENV NODE_ENV=production
ENV KERNEL_DEFAULTS_DIR=/app/defaults
WORKDIR /app

COPY --from=build /app/package.json /app/package-lock.json* ./
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/vendor/open-node/packages vendor/open-node/packages
COPY --from=build /app/dist dist
COPY server server
COPY data/defaults defaults

RUN mkdir -p /app/data && chown -R node:node /app
USER node

EXPOSE 18180
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.KERNEL_LISTEN_PORT||18180)+'/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "server/index.js"]
