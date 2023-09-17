FROM node:20-alpine

WORKDIR /app

EXPOSE 8800

COPY . /app/

RUN npm install -g npm@10.1.0
RUN npm install && npm run build

CMD node ./app/image-splitter.js