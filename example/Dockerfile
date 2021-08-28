FROM node:16-alpine3.14
RUN apk add curl git nano --no-cache
WORKDIR /app
COPY ./ /app

EXPOSE 8080
CMD ["node", "index.js"]

