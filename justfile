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
	# Wait for the image-splitter service to be ready by polling its base URL
	echo "Waiting for image-splitter service..."
	timeout := 60
	interval := 2
	elapsed := 0
	@until curl --fail --silent --output /dev/null http://localhost:8800; do \
	  if [ {{elapsed}} -ge {{timeout}} ]; then \
	    echo "Service http://localhost:8800 did not become ready within {{timeout}} seconds."; \
	    echo "Dumping logs:"; \
	    COMPOSE_PROJECT_NAME=gratheon-test docker compose -f docker-compose.test.yml logs; \
	    exit 1; \
	  fi; \
	  sleep {{interval}}; \
	  elapsed=$$(expr {{elapsed}} + {{interval}}); \
	done
	@echo "Service is ready."
	@npm run test:integration
