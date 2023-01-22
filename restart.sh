cd /www/image-splitter/
COMPOSE_PROJECT_NAME=gratheon docker-compose down

sudo -H -u www bash -c 'cd /www/image-splitter/ && nvm use && npm i' 
COMPOSE_PROJECT_NAME=gratheon docker-compose up -d --build