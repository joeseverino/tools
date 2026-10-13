import { parentPort, workerData } from 'node:worker_threads';
import { collectRepo, isCollectJob } from './collect.ts';

parentPort?.postMessage(isCollectJob(workerData) ? collectRepo(workerData) : null);
