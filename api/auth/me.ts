/**
 * GET /api/auth/me
 *
 * Protected endpoint: returns current authenticated user from JWT token.
 * Useful for frontend to restore session state on page load.
 * Requires valid JWT in Cookie header or Authorization header.
 *
 * Request: GET (no body)
 *
 * Response:
 *   200 { userId: string, email: string }
 *
 * Errors:
 *   401 - missing or invalid token
 */

import { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuth } from '../_lib/vercel-auth';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Check authentication
  const auth = requireAuth(req);
  if (!auth) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  return res.status(200).json({
    userId: auth.userId,
    email: auth.email,
  });
}
