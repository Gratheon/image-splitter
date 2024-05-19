import { analyzeQueenCups } from './detectQueenCups';
import { analyzeCells } from './detectCells';
import { analyzeBeesAndVarroa } from './detectBees';

export default function init() {
	analyzeBeesAndVarroa();
	analyzeQueenCups();
	analyzeCells();
};