FROM oven/bun:1.1.29

WORKDIR /workspace

RUN apt-get update && apt-get install -y \
    curl \
    git \
    && rm -rf /var/lib/apt/lists/*

COPY package.json bun.lockb* ./

RUN bun install

COPY . .

EXPOSE 3000

CMD ["bun", "dev"]