FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1
# The app needs Node only. Remove package managers and their unused dependencies.
RUN rm -rf /usr/local/lib/node_modules /opt/yarn-* /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg
LABEL org.opencontainers.image.source="https://github.com/afk-sapien/awaker" \
      org.opencontainers.image.licenses="MIT"
WORKDIR /app
COPY --chown=node:node package.json ./
COPY --chown=node:node dist ./dist
COPY --chown=node:node server ./server
COPY --chown=node:node LICENSE ./LICENSE
USER node
ENV AWAKER_HOST=0.0.0.0 PORT=4173
EXPOSE 4173
CMD ["node", "server/preview.js"]
