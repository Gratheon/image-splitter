import { analyzeQueenCups } from "./detectQueenCups";
import { analyzeCells } from "./detectCells";
import { detectWorkerBees } from "./detectBees";
import jobsModel, {
  TYPE_BEES,
  TYPE_CELLS,
  TYPE_CUPS,
  TYPE_QUEENS,
  TYPE_RESIZE,
  TYPE_VARROA,
  NOTIFY_JOB,
} from "../models/jobs";
import resizeOriginalToThumbnails from "./common/resizeOriginalToThumbnails";
import { detectVarroa } from "./detectVarroa";
import { detectQueens } from "./detectQueens";
import notifyViaRedis from "./redisNotifier";

export default function run() {
  jobsModel.processJobInLoop(TYPE_RESIZE, resizeOriginalToThumbnails);
  jobsModel.processJobInLoop(TYPE_BEES, detectWorkerBees);
  jobsModel.processJobInLoop(TYPE_CELLS, analyzeCells);

  // for some jobs we go a detour though DB, because
  // these jobs run on remote machines that have access only to DB
  // bees/cells jobs -> DB -> notify job -> redis -> even-stream -> web-app
  jobsModel.processJobInLoop(NOTIFY_JOB, notifyViaRedis);

  // calling external services
  // only run these jobs in production because they are expensive
  jobsModel.processJobInLoop(TYPE_VARROA, detectVarroa);
  jobsModel.processJobInLoop(TYPE_CUPS, analyzeQueenCups);
  
  // and also because we use minio in dev/test and public url is localhost:9000 that clarifai can't access
  jobsModel.processJobInLoop(TYPE_QUEENS, detectQueens);

}
