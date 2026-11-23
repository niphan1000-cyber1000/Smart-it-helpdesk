import 'dotenv/config';
import express from 'express';
import type { Request, Response } from 'express';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI, Type } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.PORT) || 3000;
const MODEL_NAME = 'gemini-2.5-flash';
const ADMIN_EMAIL = 'niphan1000@gmail.com';

type WebhookType = 'auto' | 'discord' | 'telegram' | 'custom';

interface TroubleshootData {
  summary: string;
  steps: string[];
  warningNote: string;
}

interface DiagnosticData {
  rootCause: string;
  toolsAndParts: string[];
  technicalSteps: string[];
}

interface VerifiedUser {
  uid: string;
  email: string;
  emailVerified: boolean;
}

interface TicketWebhookPayload {
  id: string;
  requesterName: string;
  department: string;
  contactInfo: string;
  category: string;
  urgency: string;
  assetTag: string;
  description: string;
}

function loadFirebaseWebApiKey(): string {
  try {
    const configPath = path.resolve(__dirname, 'firebase-applet-config.json');
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, 'utf-8');
      const parsed = JSON.parse(raw) as { apiKey?: string };
      return parsed.apiKey || '';
    }
  } catch {
    // Ignore missing config
  }
  return '';
}

const FIREBASE_WEB_API_KEY = loadFirebaseWebApiKey();

let runtimeWebhookConfig: { url: string; type: WebhookType } | null = null;

function getConfiguredApiKey(): string | null {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key || key === 'MY_GEMINI_API_KEY') {
    return null;
  }
  return key;
}

function createGeminiClient(apiKey: string): GoogleGenAI {
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function isPrivateOrBlockedIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map((n) => parseInt(n, 10));
    if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true;
    const [a, b] = parts;
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    if (
      lower === '::1' ||
      lower === '::' ||
      lower.startsWith('fc') ||
      lower.startsWith('fd') ||
      lower.startsWith('fe80')
    ) {
      return true;
    }
    return false;
  }
  return false;
}

function validateWebhookUrl(rawUrl: string): { valid: boolean; url?: URL; error?: string } {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return { valid: false, error: 'กรุณาระบุ Webhook URL' };
  }
  if (trimmed.length > 1000) {
    return { valid: false, error: 'Webhook URL ยาวเกินกำหนด' };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { valid: false, error: 'รูปแบบ URL ไม่ถูกต้อง' };
  }

  if (parsed.protocol !== 'https:') {
    return { valid: false, error: 'รองรับเฉพาะ Webhook URL แบบ HTTPS เพื่อความปลอดภัย' };
  }

  const host = parsed.hostname.toLowerCase();
  if (
    !host ||
    host === 'localhost' ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    isPrivateOrBlockedIp(host)
  ) {
    return { valid: false, error: 'ไม่อนุญาตให้ส่ง Webhook ไปยังเครือข่ายภายในหรือ Localhost' };
  }

  return { valid: true, url: parsed };
}

function maskWebhookUrl(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    const tail = rawUrl.length > 8 ? rawUrl.slice(-6) : '••••';
    return `${u.origin}/••••${tail}`;
  } catch {
    return '••••';
  }
}

function getEffectiveWebhook(): {
  url: string;
  type: WebhookType;
  source: 'env' | 'runtime' | 'none';
} {
  const envUrl = process.env.WEBHOOK_URL?.trim();
  const envType = (process.env.WEBHOOK_TYPE?.trim() as WebhookType) || 'auto';
  if (envUrl) {
    return { url: envUrl, type: envType, source: 'env' };
  }
  if (runtimeWebhookConfig) {
    return {
      url: runtimeWebhookConfig.url,
      type: runtimeWebhookConfig.type,
      source: 'runtime',
    };
  }
  return { url: '', type: 'auto', source: 'none' };
}

function detectWebhookType(url: string, configuredType: WebhookType): Exclude<WebhookType, 'auto'> {
  if (configuredType !== 'auto') return configuredType;
  const lower = url.toLowerCase();
  if (lower.includes('discord.com/api/webhooks/') || lower.includes('discordapp.com/api/webhooks/')) {
    return 'discord';
  }
  if (lower.includes('api.telegram.org/')) {
    return 'telegram';
  }
  return 'custom';
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function buildWebhookBody(
  targetKind: Exclude<WebhookType, 'auto'>,
  ticket: TicketWebhookPayload,
  isTest = false
): Record<string, unknown> {
  const prefix = isTest ? '[ทดสอบระบบแจ้งเตือน] ' : '';

  if (targetKind === 'discord') {
    const color = ticket.urgency.includes('ด่วนมาก')
      ? 0xdc2626
      : ticket.urgency === 'ด่วน'
        ? 0xd97706
        : 0x1d4ed8;
    return {
      username: 'ศูนย์แจ้งซ่อมไอที (IT Helpdesk)',
      content: `${prefix}มีใบแจ้งซ่อมใหม่ **${ticket.id}** (${ticket.urgency})`,
      embeds: [
        {
          title: `${prefix}ใบแจ้งซ่อม ${ticket.id} — ${ticket.category}`,
          description: ticket.description,
          color,
          fields: [
            { name: 'ผู้แจ้ง', value: ticket.requesterName, inline: true },
            { name: 'แผนก', value: ticket.department, inline: true },
            { name: 'ความเร่งด่วน', value: ticket.urgency, inline: true },
            { name: 'ติดต่อ', value: ticket.contactInfo, inline: true },
            { name: 'ครุภัณฑ์', value: ticket.assetTag || 'ไม่ระบุ', inline: true },
          ],
          timestamp: new Date().toISOString(),
        },
      ],
    };
  }

  if (targetKind === 'telegram') {
    const lines = [
      `<b>${escapeHtml(prefix)}แจ้งเตือนใบแจ้งซ่อมไอทีใหม่ (${escapeHtml(ticket.id)})</b>`,
      `<b>ผู้แจ้ง:</b> ${escapeHtml(ticket.requesterName)} (แผนก${escapeHtml(ticket.department)})`,
      `<b>ติดต่อ:</b> ${escapeHtml(ticket.contactInfo)}`,
      `<b>ประเภท:</b> ${escapeHtml(ticket.category)}`,
      `<b>ความเร่งด่วน:</b> ${escapeHtml(ticket.urgency)}`,
      `<b>ครุภัณฑ์:</b> ${escapeHtml(ticket.assetTag || 'ไม่ระบุ')}`,
      `<b>อาการ:</b> ${escapeHtml(ticket.description)}`,
    ];
    return {
      text: lines.join('\n'),
      parse_mode: 'HTML',
    };
  }

  const summaryText = `${prefix}ใบแจ้งซ่อมใหม่ ${ticket.id}\nผู้แจ้ง: ${ticket.requesterName} (${ticket.department})\nติดต่อ: ${ticket.contactInfo}\nประเภท: ${ticket.category}\nความเร่งด่วน: ${ticket.urgency}\nครุภัณฑ์: ${ticket.assetTag || '-'}\nอาการ: ${ticket.description}`;
  return {
    event: isTest ? 'ticket.test' : 'ticket.created',
    text: summaryText,
    message: summaryText,
    ticket: {
      ...ticket,
      createdAt: new Date().toISOString(),
    },
  };
}

async function dispatchWebhook(
  url: string,
  configuredType: WebhookType,
  ticket: TicketWebhookPayload,
  isTest = false
): Promise<void> {
  const check = validateWebhookUrl(url);
  if (!check.valid || !check.url) {
    throw new Error(check.error || 'Webhook URL ไม่ถูกต้อง');
  }

  const targetKind = detectWebhookType(check.url.toString(), configuredType);
  const body = buildWebhookBody(targetKind, ticket, isTest);

  const response = await fetch(check.url.toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'it-helpdesk-webhook/1.0',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });

  if (!response.ok) {
    throw new Error(`ปลายทาง Webhook ตอบกลับสถานะ HTTP ${response.status}`);
  }
}

async function verifyFirebaseBearerToken(req: Request): Promise<VerifiedUser | null> {
  if (!FIREBASE_WEB_API_KEY) return null;
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) return null;
  const idToken = authHeader.slice(7).trim();
  if (!idToken) return null;

  try {
    const res = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(FIREBASE_WEB_API_KEY)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
        signal: AbortSignal.timeout(6000),
      }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      users?: Array<{
        localId?: string;
        email?: string;
        emailVerified?: boolean;
      }>;
    };
    const user = data.users?.[0];
    if (!user || !user.localId || !user.email || !user.emailVerified) {
      return null;
    }
    return {
      uid: user.localId,
      email: user.email,
      emailVerified: Boolean(user.emailVerified),
    };
  } catch {
    return null;
  }
}

function buildFallbackTroubleshoot(category: string, description: string): TroubleshootData {
  const text = `${category} ${description}`.toLowerCase();

  if (text.includes('wi-fi') || text.includes('อินเทอร์เน็ต') || text.includes('เน็ต')) {
    return {
      summary: 'ปัญหาเครือข่ายเบื้องต้นมักเกิดจากการจับสัญญาณค้างหรือตัวรับสัญญาณไม่ได้รีเฟรชไอพีใหม่',
      steps: [
        'ลองปิด Wi-Fi บนเครื่องแล้วรอ 10 วินาที จากนั้นเปิดใหม่และเชื่อมต่อชื่อเครือข่ายของบริษัทอีกครั้ง',
        'ตรวจสอบว่าไม่ได้เปิดโหมดเครื่องบิน (Airplane Mode) อยู่โดยไม่ได้ตั้งใจ',
        'หากใช้สาย LAN ให้ลองขยับหัวปลั๊กที่หลังเครื่องและที่เต้ารับผนังให้แน่น จนได้ยินเสียงคลิก',
        'ลองรีสตาร์ทเครื่องคอมพิวเตอร์ 1 ครั้ง เพื่อให้ระบบขอเลข IP จากเราเตอร์ใหม่',
      ],
      warningNote: 'อย่ากดปุ่ม Reset บนตัวกระจายสัญญาณ (Router) ของสำนักงาน เพราะอาจทำให้คนอื่นใช้งานไม่ได้ครับ',
    };
  }

  if (text.includes('ปริ้น') || text.includes('สแกน') || text.includes('printer')) {
    return {
      summary: 'อาการพิมพ์ไม่ออกมักเกิดจากคิวงานค้าง กระดาษติด หรือสายเชื่อมต่อหลวม',
      steps: [
        'ตรวจดูหน้าจอหรือไฟสถานะบนตัวเครื่องปริ้นเตอร์ว่ามีไฟสีส้มกระพริบหรือแจ้งเตือนกระดาษหมด/กระดาษติดหรือไม่',
        'เปิดฝาถาดกระดาษตรวจดูว่ามีกระดาษพับหรือติดค้างอยู่ด้านในหรือไม่ หากมีให้ดึงออกเบาๆ ตามแนวกระดาษ',
        'กดปิดสวิตช์เครื่องปริ้นเตอร์ รอ 15 วินาที แล้วเปิดเครื่องใหม่อีกครั้ง',
        'ตรวจสอบที่คอมพิวเตอร์ว่าเลือกชื่อเครื่องปริ้นเตอร์ตรงกับเครื่องที่ใช้งานอยู่จริงหรือไม่',
      ],
      warningNote: 'หากกระดาษติดแน่นลึกด้านใน อย่าใช้ของมีคมหรือดึงแรงเกินไป แนะนำให้แจ้งช่างไอทีช่วยนำออกครับ',
    };
  }

  if (text.includes('เปิดไม่ติด') || text.includes('จอดำ') || text.includes('มืด')) {
    return {
      summary: 'อาการเครื่องไม่ขึ้นภาพมักเกิดจากสายไฟหลวม ปลั๊กพ่วงดับ หรือหน้าจอยังไม่ได้เปิดสวิตช์',
      steps: [
        'ตรวจสอบปลั๊กไฟและสวิตช์รางปลั๊กพ่วงว่ามีไฟเข้าปกติ และลองเสียบปลั๊กหน้าจอให้แน่นทั้งสองฝั่ง',
        'กดปุ่มเปิด/ปิดที่ตัวหน้าจอมอนิเตอร์ดูว่ามีไฟสถานะหรือโลโก้ขึ้นหรือไม่',
        'หากตัวเครื่องมีเสียงพัดลมทำงานแต่หน้าจอมืด ให้ลองขยับสายจอ (HDMI / DisplayPort / VGA) ด้านหลังเครื่องให้แน่น',
        'กดปุ่ม Power ค้างไว้ 10 วินาทีเพื่อปิดเครื่องสนิท รอ 15 วินาที แล้วกดเปิดใหม่อีกครั้ง',
      ],
      warningNote: 'ห้ามเปิดฝาเคสคอมพิวเตอร์หรือจับอุปกรณ์ภายในขณะที่ยังเสียบปลั๊กไฟอยู่โดยเด็ดขาดครับ',
    };
  }

  if (text.includes('windows') || text.includes('ค้าง') || text.includes('โปรแกรม')) {
    return {
      summary: 'อาการเครื่องค้างหรือช้าผิดปกติมักเกิดจากมีโปรแกรมทำงานซ้อนกันมากหรือไฟล์ชั่วคราวเต็ม',
      steps: [
        'ลองกดปุ่ม Ctrl + Shift + Esc พร้อมกัน เพื่อดูว่ามีโปรแกรมไหนค้างอยู่ แล้วกด End Task เฉพาะโปรแกรมนั้น',
        'บันทึกงานที่เปิดค้างไว้ให้เรียบร้อย แล้วสั่ง Restart เครื่องคอมพิวเตอร์ (ไม่ใช่ Shut down แล้วเปิดใหม่)',
        'ตรวจสอบพื้นที่ว่างในไดรฟ์ C: ว่าเหลืออย่างน้อย 15–20 GB หรือไม่ หากใกล้เต็มให้ลบไฟล์ในถังขยะ (Recycle Bin)',
        'ปิดแท็บเบราว์เซอร์หรือโปรแกรมที่ไม่ได้ใช้งานชั่วคราวเพื่อให้เครื่องทำงานคล่องขึ้น',
      ],
      warningNote: 'ก่อนรีสตาร์ทเครื่องหรือลงโปรแกรมใหม่ กรุณาบันทึกไฟล์งานสำคัญทุกครั้งเพื่อป้องกันข้อมูลสูญหายครับ',
    };
  }

  return {
    summary: 'การตรวจสอบการเชื่อมต่อและการรีสตาร์ทอุปกรณ์เบื้องต้นช่วยแก้ปัญหาทั่วไปได้หลายกรณี',
    steps: [
      'ตรวจสอบสายเชื่อมต่อ (สายไฟ, สาย USB หรือสายเมาส์/คีย์บอร์ด) ว่าเสียบแน่นสนิท หรือลองสลับไปเสียบช่อง USB ช่องอื่น',
      'หากเป็นอุปกรณ์ไร้สาย ลองเปลี่ยนถ่านหรือชาร์จแบตเตอรี่ และตรวจดูว่าเปิดสวิตช์ใต้ตัวอุปกรณ์แล้ว',
      'บันทึกงานทั้งหมดแล้วลอง Restart คอมพิวเตอร์ 1 ครั้ง เพื่อรีเฟรชไดรเวอร์และระบบการทำงาน',
      'สังเกตข้อความแจ้งเตือน (Error) ที่ขึ้นบนหน้าจอเพื่อใช้แจ้งรายละเอียดเพิ่มเติมหากยังไม่หาย',
    ],
    warningNote: 'หากลองทำตามขั้นตอนแล้วอาการไม่ดีขึ้น หรืออุปกรณ์มีกลิ่นไหม้/เสียงผิดปกติ ให้หยุดใช้งานและส่งเรื่องให้ช่างทันทีครับ',
  };
}

function buildFallbackDiagnostic(category: string, description: string): DiagnosticData {
  const text = `${category} ${description}`.toLowerCase();

  if (text.includes('wi-fi') || text.includes('อินเทอร์เน็ต') || text.includes('เน็ต')) {
    return {
      rootCause: 'DHCP Lease ขัดข้อง, ไดรเวอร์ Wi-Fi Adapter ค้างในโหมดประหยัดพลังงาน หรือสัญญาณ AP บริเวณจุดใช้งานอ่อน/ชนแชนแนล',
      toolsAndParts: [
        'สาย LAN CAT6 สำรองสำหรับทดสอบเทียบ',
        'USB Wi-Fi Dongle สำรอง',
        'USB Drive รวมไดรเวอร์ Network Card',
        'บัญชี Admin สำหรับรันคำสั่งเครือข่าย',
      ],
      technicalSteps: [
        'ตรวจสอบ IPconfig / Gateway และสั่ง ipconfig /release, ipconfig /renew, netsh winsock reset',
        'ปิดการตั้งค่า Allow the computer to turn off this device to save power ใน Device Manager',
        'อัปเดตหรือ Rollback ไดรเวอร์ Wireless LAN และทดสอบ Ping ไปยัง Gateway / DNS ภายใน',
        'ตรวจเช็กจุดครอบคลุมสัญญาณ Access Point ในโซนแผนกผู้แจ้งหากหลุดซ้ำทุก 10 นาที',
      ],
    };
  }

  if (text.includes('ปริ้น') || text.includes('สแกน') || text.includes('printer')) {
    return {
      rootCause: 'Print Spooler Service ค้าง, เซ็นเซอร์ถาดกระดาษสกปรก/กระดาษติดค้าง หรือพอร์ต IP เครื่องพิมพ์เปลี่ยน',
      toolsAndParts: [
        'ไขควงและคีมคีบปลายแหลม (กรณีกระดาษติดลึก)',
        'ผ้าสะอาดและน้ำยาเช็ดลูกยางดึงกระดาษ',
        'สาย USB Printer หรือสาย LAN สำรอง',
        'ไฟล์ Driver Printer รุ่นที่ใช้งาน',
      ],
      technicalSteps: [
        'ตรวจเช็ก Error Code / ไฟ LED บนเครื่องพิมพ์ และเคลียร์กระดาษหรือฝุ่นบริเวณ Feed Roller',
        'รีสตาร์ท Print Spooler Service และล้างไฟล์คิวค้างใน C:\\Windows\\System32\\spool\\PRINTERS',
        'ตรวจสอบพอร์ต Standard TCP/IP Port ของเครื่องพิมพ์บนเครื่องลูกข่ายให้ตรงกับ IP ปัจจุบัน',
        'สั่งพิมพ์ Test Page และตรวจสอบคุณภาพหมึก/ฟิวเซอร์',
      ],
    };
  }

  if (text.includes('เปิดไม่ติด') || text.includes('จอดำ') || text.includes('มืด')) {
    return {
      rootCause: 'หน้าสัมผัส RAM ออกซิไดซ์ทำให้ไม่ผ่าน POST, สายสัญญาณภาพ DisplayPort/HDMI เสีย หรือ Power Supply จ่ายไฟไม่เสถียร',
      toolsAndParts: [
        'สาย DisplayPort / HDMI และสาย AC Power สำรอง',
        'ยางลบทำความสะอาดหน้าสัมผัส RAM / แปรงปัดฝุ่น',
        'PSU Tester หรือ Power Supply สำรอง',
        'ไขควงชุดซ่อมคอมพิวเตอร์',
      ],
      technicalSteps: [
        'ถอดปลั๊กและถอดแผง RAM ออกมาทำความสะอาดหน้าสัมผัสทองเหลืองแล้วเสียบกลับให้แน่น',
        'สลับสายสัญญาณภาพและทดสอบต่อจอมอนิเตอร์สำรองเพื่อตัดประเด็นจอเสีย',
        'สังเกต Beep Code หรือไฟ Debug LED (CPU/DRAM/VGA/BOOT) บนเมนบอร์ด',
        'ทดสอบเปลี่ยนสายไฟ AC หรือเช็กแรงดันไฟจาก Power Supply หากยังไม่ขึ้นภาพ',
      ],
    };
  }

  if (text.includes('windows') || text.includes('ค้าง') || text.includes('โปรแกรม')) {
    return {
      rootCause: 'ไฟล์ระบบ Windows เสียหาย, SSD มี Health ต่ำ/พื้นที่เต็ม หรือโปรไฟล์ผู้ใช้/โปรแกรมบัญชีมีไฟล์แคชขัดแย้ง',
      toolsAndParts: [
        'USB Boot Windows 11 Pro พร้อมไฟล์ติดตั้ง',
        'External SSD สำหรับสำรองข้อมูลผู้ใช้งาน',
        'ชุดไฟล์ติดตั้ง MS Office, โปรแกรมบัญชี และ Driver Pack',
        'License Key / BitLocker Recovery Key (ถ้ามี)',
      ],
      technicalSteps: [
        'เช็กสุขภาพดิสก์ (CrystalDiskInfo / SMART) และตรวจ Event Viewer หา Error ก่อนทำการล้างเครื่อง',
        'สำรองข้อมูล Desktop, Documents, ฐานข้อมูลโปรแกรมบัญชี และอีเมลไปยัง External SSD',
        'รันคำสั่ง sfc /scannow และ DISM ก่อน หรือดำเนินการ Clean Install Windows 11 หากระบบเสียหายหนัก',
        'ติดตั้งไดรเวอร์ครบถ้วน เข้าร่วม Domain/Workgroup และทดสอบเปิดโปรแกรมงานจริงร่วมกับผู้ใช้',
      ],
    };
  }

  return {
    rootCause: 'อุปกรณ์ต่อพ่วงเสื่อมสภาพตามอายุการใช้งาน พอร์ต USB จ่ายไฟไม่นิ่ง หรือไดรเวอร์อุปกรณ์ทำงานผิดพลาด',
    toolsAndParts: [
      'ชุดเมาส์และคีย์บอร์ดทดแทน (USB / Wireless)',
      'ถ่าน AA/AAA สำรอง',
      'สเปรย์ทำความสะอาดหน้าสัมผัส (Contact Cleaner)',
    ],
    technicalSteps: [
      'ทดสอบนำอุปกรณ์ไปเสียบกับเครื่องอื่นเพื่อแยกสาเหตุระหว่างตัวอุปกรณ์กับพอร์ตของคอมพิวเตอร์',
      'ถอนการติดตั้งไดรเวอร์ HID ใน Device Manager แล้วสแกนหาฮาร์ดแวร์ใหม่',
      'หากสวิตช์ปุ่มกดหรือเซ็นเซอร์เสื่อม ให้เบิกอุปกรณ์ใหม่จากคลังและอัปเดตทะเบียนครุภัณฑ์',
    ],
  };
}

function getSafeErrorMessage(err: unknown): { status: number; message: string } {
  if (err && typeof err === 'object') {
    const record = err as Record<string, unknown>;
    const status = typeof record.status === 'number' ? record.status : 500;
    const rawMsg = typeof record.message === 'string' ? record.message : 'เกิดข้อผิดพลาดในการเชื่อมต่อ Gemini API';
    if (status === 403 || rawMsg.includes('PERMISSION_DENIED') || status === 400 || rawMsg.includes('API_KEY_INVALID')) {
      return {
        status,
        message: 'API Key ไม่ถูกต้องหรือไม่มีสิทธิ์ใช้งาน กรุณาตรวจสอบค่า GEMINI_API_KEY ใน Settings > Secrets',
      };
    }
    if (status === 429 || rawMsg.includes('RESOURCE_EXHAUSTED')) {
      return {
        status: 429,
        message: 'โควตาการใช้งาน Gemini API เต็มชั่วคราว กรุณารอสักครู่แล้วลองใหม่อีกครั้ง',
      };
    }
    return { status, message: rawMsg };
  }
  return { status: 500, message: 'เกิดข้อผิดพลาดในการเชื่อมต่อ Gemini API' };
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/ai/status', (_req: Request, res: Response) => {
    const configured = Boolean(getConfiguredApiKey());
    res.json({
      configured,
      model: MODEL_NAME,
    });
  });

  // User Portal: AI Troubleshooting Assistant
  app.post('/api/ai/troubleshoot', async (req: Request, res: Response) => {
    const category = typeof req.body?.category === 'string' ? req.body.category.trim() : '';
    const description = typeof req.body?.description === 'string' ? req.body.description.trim() : '';

    if (!category || !description) {
      res.status(400).json({
        error: 'กรุณาระบุประเภทปัญหาและรายละเอียดอาการเสียก่อนให้ AI ช่วยวิเคราะห์',
      });
      return;
    }

    const apiKey = getConfiguredApiKey();
    if (!apiKey) {
      const fallback = buildFallbackTroubleshoot(category, description);
      res.json({
        source: 'fallback',
        model: MODEL_NAME,
        notice: 'ยังไม่ได้ตั้งค่า GEMINI_API_KEY ใน Environment — แสดงผลจากโหมดจำลองคำตอบ (Fallback Mock AI)',
        data: fallback,
      });
      return;
    }

    try {
      const ai = createGeminiClient(apiKey);
      const response = await ai.models.generateContent({
        model: MODEL_NAME,
        contents: `ประเภทปัญหา: ${category}\nรายละเอียดอาการเสียจากผู้ใช้งาน: ${description}`,
        config: {
          systemInstruction:
            'คุณคือผู้ช่วยฝ่ายไอที (IT Helpdesk) ที่สุภาพและใจดี หน้าที่ของคุณคือช่วยพนักงานออฟฟิศทั่วไปแก้ปัญหาเบื้องต้นด้วยตนเองก่อนส่งซ่อม ตอบเป็นภาษาไทยที่เข้าใจง่าย หลีกเลี่ยงศัพท์เทคนิคที่ซับซ้อน แบ่งขั้นตอนเป็นข้อๆ ที่ทำตามได้จริงและปลอดภัย ไม่เสี่ยงทำให้อุปกรณ์เสียหาย',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              summary: {
                type: Type.STRING,
                description: 'สรุปสาเหตุเบื้องต้นสั้นๆ 1-2 ประโยคด้วยภาษาที่เข้าใจง่าย',
              },
              steps: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: 'ขั้นตอนการแก้ไขด้วยตนเอง 3-5 ข้อ เรียงลำดับจากง่ายไปยาก ไม่ต้องใส่เลขข้อนำหน้า',
              },
              warningNote: {
                type: Type.STRING,
                description: 'ข้อควรระวังสั้นๆ เพื่อความปลอดภัยของข้อมูลและอุปกรณ์ 1 ประโยค',
              },
            },
            required: ['summary', 'steps', 'warningNote'],
          },
        },
      });

      const rawText = (response.text ?? '{}').trim();
      const parsed = JSON.parse(rawText) as Partial<TroubleshootData>;
      const data: TroubleshootData = {
        summary: parsed.summary || 'ลองตรวจสอบตามขั้นตอนเบื้องต้นด้านล่างนี้ก่อนแจ้งช่างครับ',
        steps: Array.isArray(parsed.steps) && parsed.steps.length > 0
          ? parsed.steps
          : buildFallbackTroubleshoot(category, description).steps,
        warningNote: parsed.warningNote || 'กรุณาบันทึกงานสำคัญก่อนรีสตาร์ทเครื่องทุกครั้งครับ',
      };

      res.json({
        source: 'gemini',
        model: MODEL_NAME,
        data,
      });
    } catch (err) {
      const safeErr = getSafeErrorMessage(err);
      res.status(safeErr.status).json({ error: safeErr.message });
    }
  });

  // IT Admin Dashboard: Deep Technical Diagnostic
  app.post('/api/ai/diagnostic', async (req: Request, res: Response) => {
    const ticketId = typeof req.body?.ticketId === 'string' ? req.body.ticketId.trim() : '';
    const category = typeof req.body?.category === 'string' ? req.body.category.trim() : '';
    const description = typeof req.body?.description === 'string' ? req.body.description.trim() : '';
    const urgency = typeof req.body?.urgency === 'string' ? req.body.urgency.trim() : '';
    const assetTag = typeof req.body?.assetTag === 'string' ? req.body.assetTag.trim() : '';
    const department = typeof req.body?.department === 'string' ? req.body.department.trim() : '';

    if (!category || !description) {
      res.status(400).json({ error: 'ข้อมูลใบแจ้งซ่อมไม่ครบถ้วนสำหรับการวิเคราะห์' });
      return;
    }

    const apiKey = getConfiguredApiKey();
    if (!apiKey) {
      const fallback = buildFallbackDiagnostic(category, description);
      res.json({
        source: 'fallback',
        model: MODEL_NAME,
        notice: 'ยังไม่ได้ตั้งค่า GEMINI_API_KEY ใน Environment — แสดงผลจากโหมดจำลองคำตอบ (Fallback Mock AI)',
        data: fallback,
      });
      return;
    }

    try {
      const ai = createGeminiClient(apiKey);
      const prompt = [
        `รหัสใบงาน: ${ticketId || '-'}`,
        `แผนก: ${department || '-'}`,
        `หมายเลขครุภัณฑ์: ${assetTag || 'ไม่ระบุ'}`,
        `ความเร่งด่วน: ${urgency || '-'}`,
        `ประเภทปัญหา: ${category}`,
        `รายละเอียดอาการเสีย: ${description}`,
      ].join('\n');

      const response = await ai.models.generateContent({
        model: MODEL_NAME,
        contents: prompt,
        config: {
          systemInstruction:
            'คุณคือหัวหน้าทีมวิศวกรฝ่ายซ่อมบำรุงไอที (Senior IT Support Engineer) วิเคราะห์ใบแจ้งซ่อมในมุมมองช่างเทคนิคเพื่อเตรียมความพร้อมก่อนเข้าหน้างาน สรุปสั้น กระชับ ตรงประเด็น 3 หัวข้อ: (1) สาเหตุหลักที่เป็นไปได้ (Root Cause) (2) รายการอุปกรณ์/อะไหล่/โปรแกรมที่ช่างควรเตรียมไปหน้างาน (3) แนวทางการแก้ไขระดับเทคนิคแบบเป็นขั้นตอน',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              rootCause: {
                type: Type.STRING,
                description: 'สรุปสาเหตุหลักที่เป็นไปได้ (Root Cause) แบบกระชับในมุมมองช่างเทคนิค',
              },
              toolsAndParts: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: 'รายการอุปกรณ์ อะไหล่ หรือโปรแกรมที่ช่างควรเตรียมติดตัวไปหน้างาน 3-5 รายการ',
              },
              technicalSteps: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: 'แนวทางการตรวจสอบและแก้ไขระดับเทคนิค 3-4 ขั้นตอน ไม่ต้องใส่เลขข้อนำหน้า',
              },
            },
            required: ['rootCause', 'toolsAndParts', 'technicalSteps'],
          },
        },
      });

      const rawText = (response.text ?? '{}').trim();
      const parsed = JSON.parse(rawText) as Partial<DiagnosticData>;
      const fallback = buildFallbackDiagnostic(category, description);
      const data: DiagnosticData = {
        rootCause: parsed.rootCause || fallback.rootCause,
        toolsAndParts:
          Array.isArray(parsed.toolsAndParts) && parsed.toolsAndParts.length > 0
            ? parsed.toolsAndParts
            : fallback.toolsAndParts,
        technicalSteps:
          Array.isArray(parsed.technicalSteps) && parsed.technicalSteps.length > 0
            ? parsed.technicalSteps
            : fallback.technicalSteps,
      };

      res.json({
        source: 'gemini',
        model: MODEL_NAME,
        data,
      });
    } catch (err) {
      const safeErr = getSafeErrorMessage(err);
      res.status(safeErr.status).json({ error: safeErr.message });
    }
  });

  // Webhook Status (Admin only)
  app.get('/api/webhook/status', async (req: Request, res: Response) => {
    const user = await verifyFirebaseBearerToken(req);
    if (!user || user.email !== ADMIN_EMAIL) {
      res.status(403).json({ error: 'เฉพาะเจ้าหน้าที่ไอทีผู้ดูแลระบบเท่านั้น' });
      return;
    }

    const effective = getEffectiveWebhook();
    res.json({
      configured: Boolean(effective.url),
      source: effective.source,
      maskedUrl: effective.url ? maskWebhookUrl(effective.url) : '',
      type: effective.type,
    });
  });

  // Configure runtime Webhook URL (Admin only, stored server-side)
  app.post('/api/webhook/config', async (req: Request, res: Response) => {
    const user = await verifyFirebaseBearerToken(req);
    if (!user || user.email !== ADMIN_EMAIL) {
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
      runtimeWebhookConfig = null;
      const effective = getEffectiveWebhook();
      res.json({
        configured: Boolean(effective.url),
        source: effective.source,
        maskedUrl: effective.url ? maskWebhookUrl(effective.url) : '',
        type: effective.type,
      });
      return;
    }

    const check = validateWebhookUrl(url);
    if (!check.valid || !check.url) {
      res.status(400).json({ error: check.error || 'Webhook URL ไม่ถูกต้อง' });
      return;
    }

    runtimeWebhookConfig = { url: check.url.toString(), type };
    const effective = getEffectiveWebhook();
    res.json({
      configured: true,
      source: effective.source,
      maskedUrl: maskWebhookUrl(effective.url),
      type: effective.type,
    });
  });

  // Send Test Webhook (Admin only)
  app.post('/api/webhook/test', async (req: Request, res: Response) => {
    const user = await verifyFirebaseBearerToken(req);
    if (!user || user.email !== ADMIN_EMAIL) {
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
          description: 'ข้อความทดสอบจากศูนย์บริการแจ้งซ่อมไอที เพื่อยืนยันว่า Webhook เชื่อมต่อสำเร็จ',
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

  // Notify Webhook on New Repair Ticket (Any authenticated verified employee)
  app.post('/api/webhook/notify', async (req: Request, res: Response) => {
    const user = await verifyFirebaseBearerToken(req);
    if (!user) {
      res.status(401).json({ error: 'กรุณาเข้าสู่ระบบก่อนส่งการแจ้งเตือน' });
      return;
    }

    const effective = getEffectiveWebhook();
    if (!effective.url) {
      res.json({ sent: false, skipped: true, reason: 'Webhook ยังไม่ได้ถูกตั้งค่า' });
      return;
    }

    const ticket: TicketWebhookPayload = {
      id: typeof req.body?.id === 'string' ? req.body.id.slice(0, 32) : '',
      requesterName: typeof req.body?.requesterName === 'string' ? req.body.requesterName.slice(0, 100) : '',
      department: typeof req.body?.department === 'string' ? req.body.department.slice(0, 40) : '',
      contactInfo: typeof req.body?.contactInfo === 'string' ? req.body.contactInfo.slice(0, 120) : '',
      category: typeof req.body?.category === 'string' ? req.body.category.slice(0, 100) : '',
      urgency: typeof req.body?.urgency === 'string' ? req.body.urgency.slice(0, 60) : '',
      assetTag: typeof req.body?.assetTag === 'string' ? req.body.assetTag.slice(0, 64) : '',
      description: typeof req.body?.description === 'string' ? req.body.description.slice(0, 2000) : '',
    };

    if (!ticket.id || !ticket.requesterName || !ticket.description) {
      res.status(400).json({ error: 'ข้อมูลใบแจ้งซ่อมไม่ครบถ้วน' });
      return;
    }

    try {
      await dispatchWebhook(effective.url, effective.type, ticket, false);
      res.json({ sent: true });
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : 'ส่งการแจ้งเตือน Webhook ไม่สำเร็จ',
      });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req: Request, res: Response) => {
      const indexPath = path.join(distDir, 'index.html');
      if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
      } else {
        res.status(404).send('Build output not found.');
      }
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`IT Helpdesk server running at http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
