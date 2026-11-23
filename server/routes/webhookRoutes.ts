import { Router } from 'express';
import type { Request, Response } from 'express';
import { webhookUidLimiter } from '../config.ts';
import {
  fetchFirestoreTicketAsUser,
  isAdminUser,
  verifyFirebaseBearerToken,
  writeBackendAuditLog,
} from '../auth.ts';
import {
  clearRuntimeWebhookConfig,
  dispatchWebhook,
  getEffectiveWebhook,
  getWebhookStatusInfo,
  setRuntimeWebhookConfig,
} from '../services/webhook.ts';
import type { WebhookType } from '../services/webhook.ts';

export function createWebhookRouter(): Router {
  const router = Router();

  // Webhook Status (Admin only)
  router.get('/status', async (req: Request, res: Response) => {
    const user = await verifyFirebaseBearerToken(req);
    if (!user) {
      res.status(401).json({ error: 'กรุณาเข้าสู่ระบบ' });
      return;
    }
    if (!(await isAdminUser(user))) {
      res.status(403).json({ error: 'เฉพาะเจ้าหน้าที่ไอทีผู้ดูแลระบบเท่านั้น' });
      return;
    }

    res.json(getWebhookStatusInfo());
  });

  // Configure runtime Webhook URL (Admin only, stored server-side)
  router.post('/config', async (req: Request, res: Response) => {
    const user = await verifyFirebaseBearerToken(req);
    if (!user) {
      res.status(401).json({ error: 'กรุณาเข้าสู่ระบบ' });
      return;
    }
    if (!(await isAdminUser(user))) {
      res.status(403).json({ error: 'เฉพาะเจ้าหน้าที่ไอทีผู้ดูแลระบบเท่านั้น' });
      return;
    }

    const url = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
    const typeRaw = typeof req.body?.type === 'string' ? req.body.type.trim() : 'auto';
    const type: WebhookType =
      typeRaw === 'discord' || typeRaw === 'telegram' || typeRaw === 'custom'
        ? typeRaw
        : 'auto';

    if (!url) {
      const status = clearRuntimeWebhookConfig();
      await writeBackendAuditLog(user, {
        action: 'webhook.config_updated',
        targetId: 'webhook',
        summary: 'ล้างการตั้งค่า Runtime Webhook ชั่วคราวผ่าน Trusted Backend',
      });
      res.json(status);
      return;
    }

    const result = await setRuntimeWebhookConfig(url, type);
    if (result.ok === false) {
      res.status(400).json({ error: result.error });
      return;
    }

    await writeBackendAuditLog(user, {
      action: 'webhook.config_updated',
      targetId: 'webhook',
      summary: `อัปเดตการตั้งค่า Runtime Webhook (${type}) ผ่าน Trusted Backend`,
    });
    res.json(result.status);
  });

  // Send Test Webhook (Admin only)
  router.post('/test', async (req: Request, res: Response) => {
    const user = await verifyFirebaseBearerToken(req);
    if (!user) {
      res.status(401).json({ error: 'กรุณาเข้าสู่ระบบ' });
      return;
    }
    if (!(await isAdminUser(user))) {
      res.status(403).json({ error: 'เฉพาะเจ้าหน้าที่ไอทีผู้ดูแลระบบเท่านั้น' });
      return;
    }

    const effective = getEffectiveWebhook();
    if (!effective.url) {
      res.status(400).json({ error: 'ยังไม่ได้ตั้งค่า Webhook URL' });
      return;
    }

    try {
      await dispatchWebhook(
        effective.url,
        effective.type,
        {
          id: 'IT-TEST-001',
          requesterName: 'ระบบทดสอบการแจ้งเตือน',
          department: 'ไอที',
          contactInfo: 'ต่อ 100',
          category: 'คอมพิวเตอร์เปิดไม่ติด/จอดำ',
          urgency: 'ด่วน',
          assetTag: 'IT-TEST-PC',
          description:
            'ข้อความทดสอบจากศูนย์บริการแจ้งซ่อมไอที เพื่อยืนยันว่า Webhook เชื่อมต่อสำเร็จ',
        },
        true
      );
      res.json({ ok: true, message: 'ส่งข้อความทดสอบไปยัง Webhook เรียบร้อยแล้ว' });
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : 'ไม่สามารถส่งข้อความไปยัง Webhook ได้',
      });
    }
  });

  // Notify Webhook on New Repair Ticket (Verified against Firestore Ticket Ownership + Rate-limited)
  router.post('/notify', async (req: Request, res: Response) => {
    const user = await verifyFirebaseBearerToken(req);
    if (!user) {
      res.status(401).json({ error: 'กรุณาเข้าสู่ระบบก่อนส่งการแจ้งเตือน' });
      return;
    }

    const rateCheck = await webhookUidLimiter.check(user.uid);
    if (!rateCheck.allowed) {
      res.setHeader('Retry-After', String(rateCheck.retryAfterSeconds));
      res.status(rateCheck.unavailable ? 503 : 429).json({
        error: rateCheck.unavailable
          ? `ระบบควบคุมการแจ้งเตือนชั่วคราวไม่สามารถเชื่อมต่อฐานข้อมูลกลางได้ กรุณารอ ${rateCheck.retryAfterSeconds} วินาที`
          : `ส่งการแจ้งเตือนถี่เกินไป กรุณารอ ${rateCheck.retryAfterSeconds} วินาที`,
      });
      return;
    }

    const effective = getEffectiveWebhook();
    if (!effective.url) {
      res.json({ sent: false, skipped: true, reason: 'Webhook ยังไม่ได้ถูกตั้งค่า' });
      return;
    }

    const ticketId = typeof req.body?.ticketId === 'string' ? req.body.ticketId.trim() : '';
    if (!/^IT-[0-9]{4}-[0-9]{3,6}$/.test(ticketId)) {
      res.status(400).json({ error: 'รหัสใบแจ้งซ่อมไม่ถูกต้อง' });
      return;
    }

    // Fetch authoritative ticket directly from Firestore using caller's ID Token (Firestore Rules enforced)
    const { status: fsStatus, ticket: verifiedTicket } = await fetchFirestoreTicketAsUser(
      ticketId,
      user.idToken
    );

    if (fsStatus === 404) {
      res.status(404).json({ error: 'ไม่พบใบแจ้งซ่อมนี้ในฐานข้อมูล' });
      return;
    }
    if (fsStatus === 403 || !verifiedTicket) {
      res.status(403).json({ error: 'ไม่มีสิทธิ์ส่งการแจ้งเตือนสำหรับใบแจ้งซ่อมนี้' });
      return;
    }

    const callerIsOwner = verifiedTicket.createdByUid === user.uid;
    if (!callerIsOwner && !(await isAdminUser(user))) {
      res.status(403).json({ error: 'ไม่มีสิทธิ์ส่งการแจ้งเตือนสำหรับใบงานของผู้อื่น' });
      return;
    }

    try {
      await dispatchWebhook(
        effective.url,
        effective.type,
        {
          id: verifiedTicket.id,
          requesterName: verifiedTicket.requesterName,
          department: verifiedTicket.department,
          contactInfo: verifiedTicket.contactInfo,
          category: verifiedTicket.category,
          urgency: verifiedTicket.urgency,
          assetTag: verifiedTicket.assetTag,
          description: verifiedTicket.description,
        },
        false
      );
      res.json({ sent: true });
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : 'ส่งการแจ้งเตือน Webhook ไม่สำเร็จ',
      });
    }
  });

  return router;
}
