# FROM node:16-alpine
FROM ubuntu:22.04

ENV NODE_VERSION=16.16.0
RUN apt-get update && apt-get install -y curl
RUN curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
ENV NVM_DIR=/root/.nvm
RUN . "$NVM_DIR/nvm.sh" && nvm install ${NODE_VERSION}
RUN . "$NVM_DIR/nvm.sh" && nvm use v${NODE_VERSION}
RUN . "$NVM_DIR/nvm.sh" && nvm alias default v${NODE_VERSION}
ENV PATH="/root/.nvm/versions/node/v${NODE_VERSION}/bin/:${PATH}"
RUN node --version
RUN npm --version

# ensure all directories exist
WORKDIR /app

EXPOSE 8800

COPY package.json /app/package.json
COPY package-lock.json /app/package-lock.json
COPY models-yolov5/requirements.txt /app/models-yolov5/requirements.txt

RUN apt-get install -y python3 pip ffmpeg libsm6 libxext6
RUN cd /app/models-yolov5 && pip install -r requirements.txt

CMD ["node", "/app/app/image-splitter.js"]
