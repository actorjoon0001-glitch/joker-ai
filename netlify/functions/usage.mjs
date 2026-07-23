import handler from '../../api/usage.js';
import { wrapVercelHandler } from '../lib/adapter.mjs';

export default wrapVercelHandler(handler);
export const config = { path: '/api/usage' };
