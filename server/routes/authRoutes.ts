import { Router } from 'express';
import type { Request, Response } from 'express';
import { isAdminUser, verifyFirebaseBearerToken } from '../auth.ts';
import type { VerifiedUser } from '../auth.ts';

export interface AuthSessionPayload {
  uid: string;
  email: string;
  emailVerified: boolean;
  role: 'admin' | 'employee';
  isAdmin: boolean;
  claims: {
    admin: boolean;
  };
  authSource: 'custom_claim' | 'allowlist_or_db' | 'standard';
}

export async function buildAuthSessionPayload(
  user: VerifiedUser
): Promise<AuthSessionPayload> {
  const admin = await isAdminUser(user);
  return {
    uid: user.uid,
    email: user.email,
    emailVerified: user.emailVerified,
    role: admin ? 'admin' : 'employee',
    isAdmin: admin,
    claims: {
      admin: user.isAdminClaim,
    },
    authSource: user.isAdminClaim
      ? 'custom_claim'
      : admin
        ? 'allowlist_or_db'
        : 'standard',
  };
}

export function createAuthRouter(): Router {
  const router = Router();

  router.get('/session', async (req: Request, res: Response) => {
    const user = await verifyFirebaseBearerToken(req);
    if (!user) {
      res.status(401).json({ error: 'กรุณาเข้าสู่ระบบและยืนยันอีเมลก่อนตรวจสอบสิทธิ์' });
      return;
    }

    const session = await buildAuthSessionPayload(user);
    res.json(session);
  });

  return router;
}
