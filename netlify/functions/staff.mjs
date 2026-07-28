import handler from '../../api/staff.js';
import { wrapVercelHandler } from '../lib/adapter.mjs';

export default wrapVercelHandler(handler);
export const config = { path: '/api/staff' };
