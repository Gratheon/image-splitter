import { logger } from "../logger";
import { publisher } from "../redisPubSub";

export default async function notifyViaRedis(ref_id, payload) {
  logger.info("Publishing to redis channel " + payload.redisChannelName);
  await publisher().publish(
    payload.redisChannelName,
    JSON.stringify({
      payload,
    }),
  );
}
