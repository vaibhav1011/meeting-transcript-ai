FROM node:20-bookworm AS deps
WORKDIR /app
COPY package.json ./
RUN npm install
RUN npx playwright install --with-deps chromium

FROM node:20-bookworm
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*
COPY . .
COPY --from=deps /app/node_modules ./node_modules
EXPOSE 8090
CMD ["node", "src/index.js"]
