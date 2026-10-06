FROM node:24-bookworm-slim AS site-build
RUN apt-get update && apt-get install -y --no-install-recommends python3 ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY documentation/package.json documentation/package-lock.json ./documentation/
RUN npm --prefix documentation ci --no-audit --no-fund
COPY .pages ./.pages
COPY public ./public
COPY documentation ./documentation
COPY ops/build.mjs ops/verify-site.py ./ops/
ARG PUBLIC_SITE_URL=https://portal.creangel.com
ARG CONTENT_REPOSITORY=castellanosfelipe/Landing-creangel
ARG CONTENT_BRANCH=main
ENV PUBLIC_SITE_URL=$PUBLIC_SITE_URL CONTENT_REPOSITORY=$CONTENT_REPOSITORY CONTENT_BRANCH=$CONTENT_BRANCH
RUN npm run build:production -- --output /opt/site --base-url "$PUBLIC_SITE_URL"

FROM node:24-bookworm-slim AS site-seed
COPY --from=site-build /opt/site /opt/seed
COPY ops/publisher/lib.mjs ops/publisher/bootstrap.mjs /opt/publisher/
COPY ops/seed.mjs /opt/seed.mjs
CMD ["node", "/opt/seed.mjs"]

FROM nginx:1.28-alpine AS web
COPY ops/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
HEALTHCHECK --interval=20s --timeout=3s CMD wget -q -O /dev/null http://127.0.0.1:8080/health || exit 1
