import Redis from "ioredis";


let subscriberInstance: Redis;
let publisherInstance: Redis;

function getRedisConfig() {
	const host = process.env.REDIS_HOST || (process.env.ENV_ID === "prod" ? "127.0.0.1" : "redis");
	const port = Number(process.env.REDIS_PORT || 6379);
	const username = process.env.REDIS_USERNAME || "default";
	const password = process.env.REDIS_PASSWORD || "pass";

	return {
		port,
		host,
		username,
		password,
		showFriendlyErrorStack: true,
		db: 0,

		enableReadyCheck: true,
		autoResubscribe: true,
		retryStrategy: (times) => {
			return Math.min(times * 500, 5000);
		},
	};
}

export const subscriber = () => {
	if(subscriberInstance){
		return subscriberInstance
	}

	subscriberInstance = new Redis(getRedisConfig());

	return subscriberInstance
}

export const publisher = () => {
	if(publisherInstance){
		return publisherInstance
	}

	publisherInstance = new Redis(getRedisConfig())

	return publisherInstance
}

export function generateChannelName(uid, ...keys) {
    return `${uid}.${keys.join('.')}`
}
