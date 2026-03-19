jest.mock('../../src/models/jobs', () => ({
  __esModule: true,
  default: {
    processJobInLoop: jest.fn(),
  },
  TYPE_BEES: 'bees',
  TYPE_CELLS: 'cells',
  TYPE_CUPS: 'cups',
  TYPE_QUEENS: 'queens',
  TYPE_RESIZE: 'resize',
  TYPE_VARROA: 'varroa',
  TYPE_VARROA_BOTTOM: 'varroa_bottom',
  TYPE_DRONES: 'drones',
  NOTIFY_JOB: 'notify',
}));

jest.mock('../../src/workers/common/resizeOriginalToThumbnails', () => ({
  __esModule: true,
  default: jest.fn(),
}));
jest.mock('../../src/workers/detectBees', () => ({ detectWorkerBees: jest.fn() }));
jest.mock('../../src/workers/detectDrones', () => ({ detectDrones: jest.fn() }));
jest.mock('../../src/workers/detectCells', () => ({ analyzeCells: jest.fn() }));
jest.mock('../../src/workers/detectVarroa', () => ({ detectVarroa: jest.fn() }));
jest.mock('../../src/workers/detectVarroaBottom', () => ({ detectVarroaBottom: jest.fn() }));
jest.mock('../../src/workers/detectQueenCups', () => ({ analyzeQueenCups: jest.fn() }));
jest.mock('../../src/workers/detectQueens', () => ({ detectQueens: jest.fn() }));
jest.mock('../../src/workers/redisNotifier', () => ({
  __esModule: true,
  default: jest.fn(),
}));

import run from '../../src/workers/orchestrator';
import jobsModel from '../../src/models/jobs';
import resizeOriginalToThumbnails from '../../src/workers/common/resizeOriginalToThumbnails';
import { detectWorkerBees } from '../../src/workers/detectBees';
import { detectDrones } from '../../src/workers/detectDrones';
import { analyzeCells } from '../../src/workers/detectCells';
import { detectVarroa } from '../../src/workers/detectVarroa';
import { detectVarroaBottom } from '../../src/workers/detectVarroaBottom';
import { analyzeQueenCups } from '../../src/workers/detectQueenCups';
import { detectQueens } from '../../src/workers/detectQueens';
import notifyViaRedis from '../../src/workers/redisNotifier';

describe('workers orchestrator', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('registers all worker loops with expected rate limits', () => {
    run();

    const processJobInLoop = (jobsModel as any).processJobInLoop as jest.Mock;
    expect(processJobInLoop).toHaveBeenCalledTimes(9);
    expect(processJobInLoop.mock.calls).toEqual([
      ['resize', resizeOriginalToThumbnails, 0],
      ['bees', detectWorkerBees, 100],
      ['drones', detectDrones, 100],
      ['cells', analyzeCells, 100],
      ['notify', notifyViaRedis, 0],
      ['varroa', detectVarroa, 2000],
      ['varroa_bottom', detectVarroaBottom, 2000],
      ['cups', analyzeQueenCups, 2000],
      ['queens', detectQueens, 2000],
    ]);
  });
});
