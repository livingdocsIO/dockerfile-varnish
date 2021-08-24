FROM node:12-alpine
RUN apk add curl git --no-cache
WORKDIR /app
COPY ./ /app

EXPOSE 8080
CMD ["node", "index.js"]

