cd /www/image-splitter/
COMPOSE_PROJECT_NAME=gratheon docker-compose down

rm -rf /www/image-splitter/app/

sudo -u www bash -c 'cd /www/image-splitter/ && source ~/.nvm/nvm.sh && nvm use && npm i && npm run build'

COMPOSE_PROJECT_NAME=gratheon docker-compose up -d --build