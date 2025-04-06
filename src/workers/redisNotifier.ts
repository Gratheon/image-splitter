import { logger } from "../logger";
import { publisher } from "../redisPubSub";

export default async function notifyViaRedis(ref_id, jobData) {
  const subscriptionPayload = jobData.payload; // Extract the actual payload
  const redisChannelName = jobData.redisChannelName;

  if (!redisChannelName || !subscriptionPayload) {
      logger.error("Missing redisChannelName or subscriptionPayload in NOTIFY_JOB", { ref_id, jobData });
      return;
  }

  logger.info("Publishing to redis channel " + redisChannelName, { subscriptionPayload });
  await publisher().publish(
    redisChannelName,
    JSON.stringify(subscriptionPayload),
  );
}
