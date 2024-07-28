import Redis from "ioredis";


let subscriberInstance: Redis;
let publisherInstance: Redis;

export const subscriber = () => {
	if(subscriberInstance){
		return subscriberInstance
	}

	subscriberInstance = new Redis({
		port: 6379,
		host: process.env.ENV_ID === "prod" ? "127.0.0.1" : "redis",
		username: "default",
		password: "pass",
		showFriendlyErrorStack: true,
		db: 0,

		enableReadyCheck: true,
		autoResubscribe: true,
		retryStrategy: (times) => {
			return Math.min(times * 500, 5000);
		},
	});

	return subscriberInstance
}

export const publisher = () => {
	if(publisherInstance){
		return publisherInstance
	}

	publisherInstance = new Redis({
		port: 6379,
		host: process.env.ENV_ID === "prod" ? "127.0.0.1" : "redis",
		username: "default",
		password: "pass",
		showFriendlyErrorStack: true,
		db: 0,

		enableReadyCheck: true,
		autoResubscribe: true,
		retryStrategy: (times) => {
			return Math.min(times * 500, 5000);
		},
	})

	return publisherInstance
}

export function generateChannelName(uid, ...keys) {
    return `${uid}.${keys.join('.')}`
}