cd /www/image-splitter/
COMPOSE_PROJECT_NAME=gratheon docker-compose down

rm -rf /www/image-splitter/app/

su www
cd /www/image-splitter/
nvm use
npm i
npm run build
git rev-parse --short HEAD > .version

COMPOSE_PROJECT_NAME=gratheon docker-compose up -d --build