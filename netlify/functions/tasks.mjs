import handler from '../../api/tasks.js';
import { wrapVercelHandler } from '../lib/adapter.mjs';

export default wrapVercelHandler(handler);
export const config = { path: '/api/tasks' };
