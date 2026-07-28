import handler from '../../api/staff-tasks.js';
import { wrapVercelHandler } from '../lib/adapter.mjs';

export default wrapVercelHandler(handler);
export const config = { path: '/api/staff-tasks' };
