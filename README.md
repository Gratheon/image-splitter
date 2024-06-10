# gratheon / image-splitter
Processes uploaded beehive frame to detect various objects.
This is more of an orchestrator.
It splits frame into multiple sections for better detection results (thus the name).
In production its upload traffic is not going via graphql-router as federated graphql is not capable of forwarding binary uploads (yet?). Results are stored in mysql and forwarded to redis.

### URLs
- Dev: http://localhost:8800
- Prod: https://image.gratheon.com/graphql


## Architecture

### Service diagram
```mermaid
flowchart LR
    web-app("<a href='https://github.com/Gratheon/web-app'>web-app</a>\n:8080") --> graphql-router("<a href='https://github.com/Gratheon/graphql-router'>graphql-router</a>") --> image-splitter("<a href='https://github.com/Gratheon/image-splitter'>image-splitter</a>\n:8800") --"poll images for processing every 500ms-10s\nstore inference results"--> mysql
    graphql-router --upload--> image-splitter --"store original upload, download for inference"--> aws-s3
	image-splitter --"detect bees"--> models-bee-detector("<a href='https://github.com/Gratheon/models-bee-detector'>models-bee-detector</a>\n:8700")
	image-splitter --"detect frame cells"--> models-frame-resources("<a href='https://github.com/Gratheon/models-frame-resources'>models-frame-resources</a>\n:8540")
	image-splitter --"detect queen cups\ndetect varroa\ndetect queens"--> clarifai("<a href='https://clarifai.com'>clarifai</a>")

	image-splitter --"event {uid}.frame_side.{frame_side_id}.bees_partially_detected"--> redis
    image-splitter --"event {uid}.frame_side.{frame_side_id}.frame_resources_detected"--> redis
    image-splitter --"event {uid}.frame_side.{frame_side_id}.queen_cups_detected"--> redis
```

### Async worker processing / data flow
```mermaid
flowchart LR
analyzeBeesAndVarroa --"re-run in 10 sec"--> analyzeBeesAndVarroa --> detectBeesAndVarroa
analyzeQueenCups --> detectQueenCups
analyzeCells --"re-run in 10 sec"--> analyzeCells
analyzeCells --> downloadAndUpdateResolutionInDB
```

### Development
```
make start
```

#### DB migrations
We use `@databases/mysql` and run migrations automatically from `migrations` folder.
Its not perfect, its just pure SQL without ability to run programmatic migrations to have rollback support.
It also assumes we have single container that runs this at the service start.
To add migration, just add new file. Try to keep same naming convention.


### Roadmap / ToDo
- Change processing mechanism from polling to a queue (kafka?) to initiate processing faster
- Add more test coverage & improve types
