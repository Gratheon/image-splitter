FROM node:20-alpine

WORKDIR /app

EXPOSE 8800

COPY . /app/

RUN npm install
RUN npm run build

CMD node ./app/image-splitter.js