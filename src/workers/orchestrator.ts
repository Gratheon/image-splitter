import { analyzeQueenCups } from './detectQueenCups';
import { analyzeCells } from './detectCells';
import { analyzeBeesAndVarroa } from './detectBees';

export default function init() {
	analyzeBeesAndVarroa();
	analyzeQueenCups();

	// in dev skip cell analysis as this model is too heavy
	if (process.env.ENV_ID !== 'dev') {
		analyzeCells();
	}
};