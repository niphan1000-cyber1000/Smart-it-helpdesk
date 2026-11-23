import { Router } from 'express';
import type { Request, Response } from 'express';
import {
  aiIpLimiter,
  aiUidLimiter,
  getClientIp,
  getConfiguredApiKey,
  MODEL_NAME,
} from '../config.ts';
import { isAdminUser, verifyFirebaseBearerToken } from '../auth.ts';
import type { VerifiedUser } from '../auth.ts';
import {
  generateAdminDiagnostic,
  generateUserTroubleshoot,
  getSafeAiErrorMessage,
} from '../services/ai.ts';

async function enforceAiRateLimit(
  user: VerifiedUser,
  req: Request,
  res: Response
): Promise<boolean> {
  const uidCheck = await aiUidLimiter.check(user.uid);
  if (!uidCheck.allowed) {
    res.setHeader('Retry-After', String(uidCheck.retryAfterSeconds));
    if (uidCheck.unavailable) {
      res.status(503).json({
        error: `ระบบควบคุมโควตา AI ชั่วคราวไม่สามารถเชื่อมต่อฐานข้อมูลกลางได้ กรุณารอ ${uidCheck.retryAfterSeconds} วินาที`,
      });
      return false;
    }
    res.status(429).json({
      error: `คุณใช้งาน AI เกินโควตาชั่วคราว กรุณารอ ${uidCheck.retryAfterSeconds} วินาทีแล้วลองใหม่`,
    });
    return false;
  }

  const ipCheck = await aiIpLimiter.check(getClientIp(req));
  if (!ipCheck.allowed) {
    res.setHeader('Retry-After', String(ipCheck.retryAfterSeconds));
    if (ipCheck.unavailable) {
      res.status(503).json({
        error: `ระบบควบคุมโควตา AI ชั่วคราวไม่สามารถเชื่อมต่อฐานข้อมูลกลางได้ กรุณารอ ${ipCheck.retryAfterSeconds} วินาที`,
      });
      return false;
    }
    res.status(429).json({
      error: `มีการเรียกใช้งาน AI จากเครือข่ายนี้จำนวนมากเกินไป กรุณารอ ${ipCheck.retryAfterSeconds} วินาที`,
    });
    return false;
  }

  return true;
}

export function createAiRouter(): Router {
  const router = Router();

  router.get('/status', async (req: Request, res: Response) => {
    const user = await verifyFirebaseBearerToken(req);
    if (!user) {
      res.status(401).json({ error: 'กรุณาเข้าสู่ระบบก่อนตรวจสอบสถานะ' });
      return;
    }
    res.json({
      configured: Boolean(getConfiguredApiKey()),
      model: MODEL_NAME,
    });
  });

  // User Portal: AI Troubleshooting Assistant (Authenticated + Rate-limited)
  router.post('/troubleshoot', async (req: Request, res: Response) => {
    const user = await verifyFirebaseBearerToken(req);
    if (!user) {
      res.status(401).json({ error: 'กรุณาเข้าสู่ระบบด้วยบัญชี Google ก่อนใช้งานผู้ช่วย AI' });
      return;
    }

    if (!(await enforceAiRateLimit(user, req, res))) return;

    const category =
      typeof req.body?.category === 'string' ? req.body.category.trim().slice(0, 100) : '';
    const description =
      typeof req.body?.description === 'string' ? req.body.description.trim().slice(0, 2000) : '';

    if (!category || !description) {
      res.status(400).json({
        error: 'กรุณาระบุประเภทปัญหาและรายละเอียดอาการเสียก่อนให้ AI ช่วยวิเคราะห์',
      });
      return;
    }

    try {
      const result = await generateUserTroubleshoot(category, description);
      res.json(result);
    } catch (err) {
      const safeErr = getSafeAiErrorMessage(err);
      res.status(safeErr.status).json({ error: safeErr.message });
    }
  });

  // IT Admin Dashboard: Deep Technical Diagnostic (Admin-only + Rate-limited)
  router.post('/diagnostic', async (req: Request, res: Response) => {
    const user = await verifyFirebaseBearerToken(req);
    if (!user) {
      res.status(401).json({ error: 'กรุณาเข้าสู่ระบบก่อนใช้งานการวิเคราะห์เชิงลึก' });
      return;
    }

    const adminAuthorized = await isAdminUser(user);
    if (!adminAuthorized) {
      res.status(403).json({
        error: 'สิทธิ์การใช้งานการวิเคราะห์เชิงลึกสงวนไว้สำหรับเจ้าหน้าที่ไอที (IT Admin) เท่านั้น',
      });
      return;
    }

    if (!(await enforceAiRateLimit(user, req, res))) return;

    const ticketId =
      typeof req.body?.ticketId === 'string' ? req.body.ticketId.trim().slice(0, 32) : '';
    const category =
      typeof req.body?.category === 'string' ? req.body.category.trim().slice(0, 100) : '';
    const description =
      typeof req.body?.description === 'string' ? req.body.description.trim().slice(0, 2000) : '';
    const urgency =
      typeof req.body?.urgency === 'string' ? req.body.urgency.trim().slice(0, 60) : '';
    const assetTag =
      typeof req.body?.assetTag === 'string' ? req.body.assetTag.trim().slice(0, 64) : '';
    const department =
      typeof req.body?.department === 'string' ? req.body.department.trim().slice(0, 40) : '';

    if (!category || !description) {
      res.status(400).json({ error: 'ข้อมูลใบแจ้งซ่อมไม่ครบถ้วนสำหรับการวิเคราะห์' });
      return;
    }

    try {
      const result = await generateAdminDiagnostic({
        ticketId,
        department,
        assetTag,
        urgency,
        category,
        description,
      });
      res.json(result);
    } catch (err) {
      const safeErr = getSafeAiErrorMessage(err);
      res.status(safeErr.status).json({ error: safeErr.message });
    }
  });

  return router;
}
