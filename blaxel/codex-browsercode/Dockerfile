FROM node:22-bookworm-slim

COPY --from=ghcr.io/blaxel-ai/sandbox:latest /sandbox-api /usr/local/bin/sandbox-api

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    bash \
    ca-certificates \
    curl \
    git \
    netcat-openbsd \
    unzip \
  && rm -rf /var/lib/apt/lists/*

RUN npm install -g @openai/codex@0.130.0 \
  && curl -fsSL https://bun.sh/install | bash \
  && ln -s /root/.bun/bin/bun /usr/local/bin/bun

RUN useradd --create-home --shell /bin/bash codex \
  && mkdir -p /opt/gavel /workspace/gavel-agent /workspace/gavel-runs /home/codex/.codex \
  && chown -R codex:codex /workspace /home/codex

COPY plugins/browsercode /opt/gavel/plugins/browsercode
COPY blaxel/codex-browsercode/codex-config.toml /home/codex/.codex/config.toml
COPY blaxel/codex-browsercode/entrypoint.sh /entrypoint.sh

RUN chmod +x /entrypoint.sh \
  && chown -R codex:codex /home/codex/.codex /opt/gavel/plugins/browsercode

USER codex
WORKDIR /workspace/gavel-agent

ENTRYPOINT ["/entrypoint.sh"]
