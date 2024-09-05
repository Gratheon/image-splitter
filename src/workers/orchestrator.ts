import { analyzeQueenCups } from './detectQueenCups';
import { analyzeCells } from './detectCells';
import { detectWorkerBees } from './detectBees';
import jobsModel, {TYPE_BEES, TYPE_CELLS, TYPE_CUPS, TYPE_QUEENS, TYPE_RESIZE, TYPE_VARROA} from "../models/jobs";
import resizeOriginalToThumbnails from "./resizeOriginalToThumbnails";
import {detectVarroa} from "./detectVarroa";
import {detectQueens} from "./detectQueens";

export default function run() {
	jobsModel.processJobInLoop(TYPE_RESIZE, resizeOriginalToThumbnails);
	jobsModel.processJobInLoop(TYPE_BEES, detectWorkerBees);
	jobsModel.processJobInLoop(TYPE_CELLS, analyzeCells);

	// calling external services
	jobsModel.processJobInLoop(TYPE_VARROA, detectVarroa);
	jobsModel.processJobInLoop(TYPE_QUEENS, detectQueens);
	jobsModel.processJobInLoop(TYPE_CUPS, analyzeQueenCups);
};