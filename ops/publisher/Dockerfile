FROM node:24-bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends git python3 ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /var/lib/publisher /srv/releases \
    && chown -R node:node /var/lib/publisher /srv/releases
WORKDIR /app
COPY --chown=node:node ops/publisher/ ./
RUN chmod 755 /app/askpass.mjs
USER node
ENV NODE_ENV=production PUBLISHER_PORT=3001
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3001/publish/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.mjs"]
