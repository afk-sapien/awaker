FROM node:25-alpine
WORKDIR /app
COPY --chown=node:node package.json ./
COPY --chown=node:node dist ./dist
COPY --chown=node:node server ./server
USER node
ENV AWAKER_HOST=0.0.0.0 PORT=4173
EXPOSE 4173
CMD ["node", "server/preview.js"]
