FROM node:24-alpine@sha256:a34ab6d7f6f4813f4d0c5469d74685604b962fbdbf5793a7bc7b4998ecb867c8
# The app needs Node only. Remove package managers and their unused dependencies.
RUN rm -rf /usr/local/lib/node_modules /opt/yarn-* /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg
LABEL org.opencontainers.image.source="https://github.com/afk-sapien/awaker" \
      org.opencontainers.image.licenses="MIT"
WORKDIR /app
COPY --chown=node:node package.json ./
COPY --chown=node:node dist ./dist
COPY --chown=node:node server ./server
COPY --chown=node:node LICENSE ./LICENSE
COPY --chown=node:node scripts/healthcheck.js scripts/http-request.js ./scripts/
RUN mkdir /app/data && chown node:node /app/data
USER node
ENV AWAKER_HOST=0.0.0.0 PORT=4173
EXPOSE 4173
VOLUME /app/data
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD ["node", "scripts/healthcheck.js"]
CMD ["node", "server/start.js"]
