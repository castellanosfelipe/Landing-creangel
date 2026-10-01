# syntax=docker/dockerfile:1
FROM python:3.14-alpine AS build
ARG SITE_URL=https://portal.creangel.com
WORKDIR /src
COPY .pages/ .pages/
COPY .docker/build.py .docker/build.py
COPY public/ public/
RUN python .docker/build.py --base-url "$SITE_URL" --output /out

FROM nginx:1.30.5-alpine
RUN rm -rf /usr/share/nginx/html/*
COPY .docker/nginx.conf /etc/nginx/nginx.conf
COPY --from=build /out/site/ /usr/share/nginx/html/
COPY --from=build /out/config/ /etc/nginx/conf.d/
RUN nginx -t
USER nginx
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -q -T 4 -O /dev/null http://127.0.0.1:8080/ || exit 1
ENTRYPOINT ["nginx"]
CMD ["-g", "daemon off;"]
