export default {
    routerSignature: "",
    sentryDsn: "",
    schema_registry_url: '',
    selfUrl: "",
    yolo_v5_url: "",
    models_frame_resources_url: "",
    mysql: {
        host: '',
        port: '',
        user: '',
        password: '',
        database: '',
    },

    aws: {
        "bucket": "",
        "key": "",
        "secret": ""
    },

    "files_base_url": "",

    jwt:{
        privateKey: "",
    },
    clarifai:{
        PAT:"",
        beekeeper_app:{
            PAT:"",
            USER_ID:"openai",
            APP_ID:"chat-completion",
            MODEL_ID:"GPT-4"
        }
    },
}