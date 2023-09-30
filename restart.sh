cd /www/image-splitter/
COMPOSE_PROJECT_NAME=gratheon docker-compose down

rm -rf /www/image-splitter/app/

git rev-parse --short HEAD > .version

sudo -H -u www bash -c 'cd /www/image-splitter/ && nvm use && npm i && npm run build' 
COMPOSE_PROJECT_NAME=gratheon docker-compose up -d --build