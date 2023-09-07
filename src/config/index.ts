import test from './config.default';

const config = {
	test
};

let mode = process.env.ENV_ID;
if(!process.env.ENV_ID) {
	mode = 'test'
} else {
	config['dev'] = import('./config.dev');
	config['prod'] = import('./config.prod');
}

export default config[mode];
