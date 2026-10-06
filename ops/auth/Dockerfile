FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --chown=node:node ops/auth/server.mjs ./server.mjs
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 CMD node --input-type=module -e "const r=await fetch('http://127.0.0.1:3000/auth/health');process.exit(r.ok?0:1)"
CMD ["node", "server.mjs"]
