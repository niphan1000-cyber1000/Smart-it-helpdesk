# ศูนย์บริการแจ้งซ่อมไอที (IT Helpdesk & Repair Ticketing)

[![CI](https://github.com/niphan1000-cyber1000/Smart-it-helpdesk/actions/workflows/ci.yml/badge.svg)](https://github.com/niphan1000-cyber1000/Smart-it-helpdesk/actions/workflows/ci.yml)

เว็บแอปพลิเคชันระบบแจ้งซ่อมคอมพิวเตอร์และอุปกรณ์ไอทีสำหรับองค์กร รองรับภาษาไทย 100% พร้อมระบบผู้ช่วย AI วิเคราะห์อาการเสีย ฐานข้อมูล Real-time และแจ้งเตือนผ่าน Webhook

## ฟีเจอร์หลัก
- **User Portal (หน้าสำหรับผู้แจ้งซ่อม):** แบบฟอร์มแจ้งซ่อม ระบุแผนก ประเภทปัญหา ความเร่งด่วน หมายเลขครุภัณฑ์ และติดตามสถานะงานซ่อมแบบ 4 ขั้นตอนแบบ Real-time
- **AI ผู้ช่วยซ่อมเบื้องต้น (Gemini 2.5 Flash):** แนะนำวิธีแก้เบื้องต้นด้วยภาษาที่เข้าใจง่าย หากลองแล้วยังไม่หายสามารถส่งเรื่องต่อให้ช่างพร้อมแนบประวัติที่ลองทำไปแล้วได้
- **IT Support Dashboard (หน้าสำหรับเจ้าหน้าที่ไอที):** แถบสรุป KPI, มุมมองตารางงานและ Kanban Board, ปุ่มรับงาน/ปิดงาน, AI วิเคราะห์เชิงลึกสำหรับช่าง (Root Cause & อุปกรณ์หน้างาน) และส่งออกรายงาน CSV (รองรับภาษาไทยใน Excel)
- **Real-time & Notifications:** เก็บข้อมูลบน Firebase Firestore พร้อม Google Login และส่งแจ้งเตือนผ่าน Discord / Telegram / Custom Webhook ทันทีเมื่อมีใบงานใหม่

## Tech Stack
- React 19, TypeScript, Tailwind CSS, Lucide Icons
- Express (`server.ts` + `server/routes/*` + `server/services/*`) & `@google/genai` (`gemini-2.5-flash`)
- Firebase Authentication & Cloud Firestore (พร้อม Atomic Ticket Counter, Audit Logs และ Distributed Rate Limiting ผ่าน Redis)

## การติดตั้งและรันโปรเจกต์
1. ติดตั้งแพ็กเกจ:
   ```bash
   npm install
   ```
2. คัดลอก `.env.example` เป็น `.env` แล้วใส่ค่าที่จำเป็น (`GEMINI_API_KEY`, `PORT`, และ `WEBHOOK_URL` หรือ `REDIS_URL` หากใช้งาน)
3. รันโหมดพัฒนา:
   ```bash
   npm run dev
   ```

## การตั้งค่าสิทธิ์ผู้ดูแลระบบ (IT Admin RBAC)
ระบบไม่ใช้การ Hardcode อีเมลผู้ดูแลในโค้ดหรือ Security Rules โดยสามารถกำหนดสิทธิ์ Admin ได้ยืดหยุ่นตาม Environment:
1. **Firebase Auth Custom Claim (แนะนำสำหรับ Production):** กำหนด Custom Claim `{ "admin": true }` ให้บัญชีเจ้าหน้าที่ไอทีผ่าน Firebase Admin SDK — `firestore.rules` และ Backend API จะตรวจสอบสิทธิ์จาก `request.auth.token.admin == true` ร่วมกับ `email_verified == true`
2. **Firestore Allowlist (`/admins/{uid}`):** เพิ่มเอกสารในคอลเลกชัน `/admins/{uid}` สำหรับผู้ดูแลระบบเพิ่มเติม (รองรับหลาย Admin โดยไม่ต้องแก้ไข Rules)
3. **Environment Variable (`ADMIN_EMAILS` / `VITE_ADMIN_EMAILS`):** ระบุอีเมล Admin คั่นด้วยเครื่องหมายจุลภาคใน `.env` หรือ Secret Manager สำหรับฝั่ง Backend/UI (ควบคู่กับ Custom Claim หรือ `/admins/{uid}` ใน Firestore)

## การจัดการ Secrets สำหรับ Production
- ห้าม Commit ไฟล์ `.env` หรือ Key ลับลงใน Git Repository (`.gitignore` บล็อก `.env*` ยกเว้น `.env.example` ไว้แล้ว)
- สำหรับ **GitHub Actions CI**: เก็บตัวแปรลับไว้ใน **GitHub Repository Secrets**
- สำหรับ **Cloud Run / Production Server**: เก็บ `GEMINI_API_KEY`, `REDIS_URL`, `REDIS_REST_TOKEN` และ `WEBHOOK_URL` ไว้ใน **Google Cloud Secret Manager / Cloud Run Secrets** แล้ว Inject เป็น Environment Variables ตอน Deploy

## การทดสอบและตรวจสอบคุณภาพโค้ด
- `npm run lint` — ตรวจสอบ TypeScript
- `npm run lint:rules` — ตรวจสอบความปลอดภัยของ `firestore.rules` ด้วย `@firebase/eslint-plugin-security-rules`
- `npm test` — รัน Unit Tests (SSRF, RBAC, Counter Plan, Rate Limiter, Modular Services)
- `npm run test:emulator` — รันชุดทดสอบเต็มร่วมกับ Firebase Firestore Emulator Suite
