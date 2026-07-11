import { analyzeCells } from "./detectCells";
import { detectWorkerBees } from "./detectBees";
import { detectDrones } from "./detectDrones";
import jobsModel, {
  TYPE_BEES,
  TYPE_CELLS,
  TYPE_QUEENS,
  TYPE_RESIZE,
  TYPE_VARROA,
  TYPE_VARROA_BOTTOM,
  TYPE_DRONES,
  NOTIFY_JOB,
} from "../models/jobs";
import resizeOriginalToThumbnails from "./common/resizeOriginalToThumbnails";
import { detectVarroa } from "./detectVarroa";
import { detectVarroaBottom } from "./detectVarroaBottom";
import { detectQueens } from "./detectQueens";
import notifyViaRedis from "./redisNotifier";

export default function run() {
  // High priority - user-blocking operations (no rate limit)
  // Priority 1 jobs are processed first
  jobsModel.processJobInLoop(TYPE_RESIZE, resizeOriginalToThumbnails, 0);
  
  // Medium priority - local AI processing (minimal rate limit to prevent CPU overload)
  // Priority 3 jobs, 100ms between jobs to allow breathing room
  jobsModel.processJobInLoop(TYPE_BEES, detectWorkerBees, 100);
  jobsModel.processJobInLoop(TYPE_DRONES, detectDrones, 100);
  jobsModel.processJobInLoop(TYPE_CELLS, analyzeCells, 100);
  
  // Special case: notification relay - high priority for user notifications
  jobsModel.processJobInLoop(NOTIFY_JOB, notifyViaRedis, 0);
  
  // Lower priority model calls, rate limited to avoid overloading model services
  jobsModel.processJobInLoop(TYPE_VARROA, detectVarroa, 2000);
  jobsModel.processJobInLoop(TYPE_VARROA_BOTTOM, detectVarroaBottom, 2000);
  jobsModel.processJobInLoop(TYPE_QUEENS, detectQueens, 2000);
}
