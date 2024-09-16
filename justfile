start:
	mkdir -p tmp
	rm -rf ./app
	# we install dependencies in the container
	# but for faster reload we re-run it here
	source $HOME/.nvm/nvm.sh && nvm install 20 && nvm use && npm i && npm run build
	COMPOSE_PROJECT_NAME=gratheon docker compose -f docker-compose.dev.yml up --build
stop:
	COMPOSE_PROJECT_NAME=gratheon docker compose -f docker-compose.dev.yml down
run:
	npm run dev

test-integration:
	COMPOSE_PROJECT_NAME=gratheon-test docker compose -f docker-compose.test.yml down
	rm -rf ./app
	source $HOME/.nvm/nvm.sh && nvm use && npm i && npm run build
	COMPOSE_PROJECT_NAME=gratheon-test docker compose -f docker-compose.test.yml up -d
	sleep 10
	npm run test:integration

test-integration-ci:
	COMPOSE_PROJECT_NAME=gratheon-test docker compose -f docker-compose.test.yml down
	rm -rf ./app
	npm i && npm run build
	COMPOSE_PROJECT_NAME=gratheon-test docker compose -f docker-compose.test.yml up -d
	sleep 30
	npm run test:integration
