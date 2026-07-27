import handler from '../../api/sms.js';
import { wrapVercelHandler } from '../lib/adapter.mjs';

export default wrapVercelHandler(handler);
export const config = { path: '/api/sms' };
