start:
	npm i
	mkdir -p tmp
	COMPOSE_PROJECT_NAME=gratheon docker compose -f docker-compose.dev.yml up --build -d
run:
	npm run dev

deploy-clean:
	ssh root@gratheon.com 'rm -rf /www/image-splitter/app/*;'

deploy-copy:
	rsync -av -e ssh Dockerfile package.json package-lock.json restart.sh .version ./models-yolov5 ./app ./src root@gratheon.com:/www/image-splitter/

deploy-run:
	ssh root@gratheon.com 'chmod +x /www/image-splitter/restart.sh'
	ssh root@gratheon.com 'bash /www/image-splitter/restart.sh'

deploy:
	git rev-parse --short HEAD > .version
	# make deploy-clean
	make deploy-copy
	make deploy-run

.PHONY: deploy
