FROM node:16-alpine

WORKDIR /app

EXPOSE 8800

# expect things to be already built
COPY . /app/

CMD node ./app/image-splitter.js