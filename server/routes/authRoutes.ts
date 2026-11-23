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

export interface AuthRouterDeps {
  verifyToken?: (req: Request) => Promise<VerifiedUser | null>;
  checkAdmin?: (user: VerifiedUser) => Promise<boolean>;
}

export async function buildAuthSessionPayload(
  user: VerifiedUser,
  checkAdmin: (user: VerifiedUser) => Promise<boolean> = isAdminUser
): Promise<AuthSessionPayload> {
  const admin = await checkAdmin(user);
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

export function createAuthRouter(deps?: AuthRouterDeps): Router {
  const router = Router();
  const verifyToken = deps?.verifyToken ?? verifyFirebaseBearerToken;
  const checkAdmin = deps?.checkAdmin ?? isAdminUser;

  router.get('/session', async (req: Request, res: Response) => {
    const user = await verifyToken(req);
    if (!user) {
      res.status(401).json({ error: 'กรุณาเข้าสู่ระบบและยืนยันอีเมลก่อนตรวจสอบสิทธิ์' });
      return;
    }

    const session = await buildAuthSessionPayload(user, checkAdmin);
    res.json(session);
  });

  return router;
}
