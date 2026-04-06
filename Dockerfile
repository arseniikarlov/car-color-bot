FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends poppler-utils python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json tsconfig.json vitest.config.ts ./
COPY src ./src
COPY data ./data
COPY tests ./tests

RUN npm install
RUN npm run build

CMD ["npm", "start"]
