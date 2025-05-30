export default {
    rootPath: "/app/",

    // this should match signature in graphql-router remote-data-source.js
    // and is meant for securing traffic, because image-splitter is also publicly accessible for direct file uploads
    routerSignature: "test-signature",

    // we use sentry for error tracking
    sentryDsn: "",

    // schema registry is used for graphql schema updates
    schema_registry_url: process.env.NATIVE ? 'http://localhost:6001/schema/push' :'http://gql-schema-registry:3000/schema/push',

    // schema-registry needs to know the url of current service for graphql-router to route traffic
    selfUrl: "image-splitter:8800",

    // url of the yolo_v5 model
    yolo_v5_url: "http://models-bee-detector:8700/",

    // url of the models-frame-resources service
    models_frame_resources_url: "http://models-frame-resources:8540/",

    // DB connection details, used also for migrations
    mysql: {
        host: 'mysql-test',
        port: '3306',
        user: 'test',
        password: 'test',
        database: 'image-splitter',
    },

    // please set own AWS S3 bucket credentials
    aws: {
        // minio
        "bucket": "gratheon-test",
        "key": "minio-admin",
        "secret": "minio-admin",

        "target_upload_endpoint": "http://minio:19000/",

        "url": {
            "public": "http://localhost:19000/gratheon-test/"
            // "public": "https://gratheon-test.s3.eu-central-1.amazonaws.com/",
        },
    },

    jwt: {
        // this must match user-cycle JWT_KEY and config.default.ts for tests
        privateKey: "somerandomtoken",
    },

    // please set own Clarifai API credentials
    clarifai: {
        PAT: "",
        varroa_app: {
            PAT: ""
        },
        queen_app: {
            PAT: ""
        },
        cup_app: {
            PAT: ""
        },
        beekeeper_app: {
            PAT: "",
            USER_ID: "openai",
            APP_ID: "chat-completion",
            MODEL_ID: "GPT-4"
        }
    }
}
