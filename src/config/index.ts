const config = {
	dev: require('./config.dev'),
	prod: require('./config.prod'),
};

const mode = process.env.ENV_ID === 'dev' ? 'dev' : 'prod';

export default config[mode];
