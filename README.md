# ศูนย์บริการแจ้งซ่อมไอที (IT Helpdesk & Repair Ticketing)

เว็บแอปพลิเคชันระบบแจ้งซ่อมคอมพิวเตอร์และอุปกรณ์ไอทีสำหรับองค์กร รองรับภาษาไทย 100% พร้อมระบบผู้ช่วย AI วิเคราะห์อาการเสีย ฐานข้อมูล Real-time และแจ้งเตือนผ่าน Webhook

## ฟีเจอร์หลัก
- **User Portal (หน้าสำหรับผู้แจ้งซ่อม):** แบบฟอร์มแจ้งซ่อม ระบุแผนก ประเภทปัญหา ความเร่งด่วน หมายเลขครุภัณฑ์ และติดตามสถานะงานซ่อมแบบ 4 ขั้นตอนแบบ Real-time
- **AI ผู้ช่วยซ่อมเบื้องต้น (Gemini 2.5 Flash):** แนะนำวิธีแก้เบื้องต้นด้วยภาษาที่เข้าใจง่าย หากลองแล้วยังไม่หายสามารถส่งเรื่องต่อให้ช่างพร้อมแนบประวัติที่ลองทำไปแล้วได้
- **IT Support Dashboard (หน้าสำหรับเจ้าหน้าที่ไอที):** แถบสรุป KPI, มุมมองตารางงานและ Kanban Board, ปุ่มรับงาน/ปิดงาน, AI วิเคราะห์เชิงลึกสำหรับช่าง (Root Cause & อุปกรณ์หน้างาน) และส่งออกรายงาน CSV (รองรับภาษาไทยใน Excel)
- **Real-time & Notifications:** เก็บข้อมูลบน Firebase Firestore พร้อม Google Login และส่งแจ้งเตือนผ่าน Discord / Telegram / Custom Webhook ทันทีเมื่อมีใบงานใหม่

## Tech Stack
- React 19, TypeScript, Tailwind CSS, Lucide Icons
- Express (`server.ts`) + `@google/genai` (`gemini-2.5-flash`)
- Firebase Authentication & Cloud Firestore

## การติดตั้งและรันโปรเจกต์
1. ติดตั้งแพ็กเกจ:
   npm install
2. คัดลอก `.env.example` เป็น `.env` แล้วใส่ค่า `GEMINI_API_KEY` (และ `WEBHOOK_URL` หากต้องการ)
3. รันโหมดพัฒนา:
   npm run dev
