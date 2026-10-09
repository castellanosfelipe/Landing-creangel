FROM node:24.21.0-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 AS site-build
RUN apt-get update && apt-get install -y --no-install-recommends python3 ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY ops/dependency-patches ./ops/dependency-patches
RUN npm ci --no-audit --no-fund
COPY documentation/package.json documentation/package-lock.json ./documentation/
RUN npm --prefix documentation ci --no-audit --no-fund
COPY .pages ./.pages
COPY public ./public
COPY documentation ./documentation
COPY ops ./ops
ARG PUBLIC_SITE_URL=https://portal.creangel.com
ENV PUBLIC_SITE_URL=$PUBLIC_SITE_URL
RUN npm run build:production -- --output /opt/site --base-url "$PUBLIC_SITE_URL"

FROM site-build AS portal-runtime
WORKDIR /workspace
USER node

FROM nginxinc/nginx-unprivileged:1.28-alpine@sha256:7377697a821c131a924a7105fafbe7414db4e9fcc77a6f08f776f33f141ec3f8 AS web
COPY ops/nginx.conf /etc/nginx/conf.d/default.conf
COPY ops/seo/nginx-redirects.conf /etc/nginx/seo/nginx-redirects.conf
COPY ops/nginx-security.conf /etc/nginx/nginx-security.conf
USER 101:101
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s CMD wget -q -O /dev/null http://127.0.0.1:8080/health || exit 1

FROM caddy:2.10.2-alpine@sha256:4c6e91c6ed0e2fa03efd5b44747b625fec79bc9cd06ac5235a779726618e530d AS proxy
# Caddy's official binary carries a file capability. Strip it at build time so
# cap_drop ALL can execute it; Compose permits its listening ports via sysctl.
USER root
RUN setcap -r /usr/bin/caddy
USER 1000:1000
