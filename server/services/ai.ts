import { GoogleGenAI, Type } from '@google/genai';
import {
  getConfiguredApiKey,
  MAX_GEMINI_OUTPUT_TOKENS,
  MODEL_NAME,
} from '../config.ts';

export interface TroubleshootData {
  summary: string;
  steps: string[];
  warningNote: string;
}

export interface DiagnosticData {
  rootCause: string;
  toolsAndParts: string[];
  technicalSteps: string[];
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

export function buildFallbackTroubleshoot(
  category: string,
  description: string
): TroubleshootData {
  const text = `${category} ${description}`.toLowerCase();

  if (text.includes('wi-fi') || text.includes('อินเทอร์เน็ต') || text.includes('เน็ต')) {
    return {
      summary:
        'ปัญหาเครือข่ายเบื้องต้นมักเกิดจากการจับสัญญาณค้างหรือตัวรับสัญญาณไม่ได้รีเฟรชไอพีใหม่',
      steps: [
        'ลองปิด Wi-Fi บนเครื่องแล้วรอ 10 วินาที จากนั้นเปิดใหม่และเชื่อมต่อชื่อเครือข่ายของบริษัทอีกครั้ง',
        'ตรวจสอบว่าไม่ได้เปิดโหมดเครื่องบิน (Airplane Mode) อยู่โดยไม่ได้ตั้งใจ',
        'หากใช้สาย LAN ให้ลองขยับหัวปลั๊กที่หลังเครื่องและที่เต้ารับผนังให้แน่น จนได้ยินเสียงคลิก',
        'ลองรีสตาร์ทเครื่องคอมพิวเตอร์ 1 ครั้ง เพื่อให้ระบบขอเลข IP จากเราเตอร์ใหม่',
      ],
      warningNote:
        'อย่ากดปุ่ม Reset บนตัวกระจายสัญญาณ (Router) ของสำนักงาน เพราะอาจทำให้คนอื่นใช้งานไม่ได้ครับ',
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
      warningNote:
        'หากกระดาษติดแน่นลึกด้านใน อย่าใช้ของมีคมหรือดึงแรงเกินไป แนะนำให้แจ้งช่างไอทีช่วยนำออกครับ',
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
      warningNote:
        'ห้ามเปิดฝาเคสคอมพิวเตอร์หรือจับอุปกรณ์ภายในขณะที่ยังเสียบปลั๊กไฟอยู่โดยเด็ดขาดครับ',
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
      warningNote:
        'ก่อนรีสตาร์ทเครื่องหรือลงโปรแกรมใหม่ กรุณาบันทึกไฟล์งานสำคัญทุกครั้งเพื่อป้องกันข้อมูลสูญหายครับ',
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
    warningNote:
      'หากลองทำตามขั้นตอนแล้วอาการไม่ดีขึ้น หรืออุปกรณ์มีกลิ่นไหม้/เสียงผิดปกติ ให้หยุดใช้งานและส่งเรื่องให้ช่างทันทีครับ',
  };
}

export function buildFallbackDiagnostic(
  category: string,
  description: string
): DiagnosticData {
  const text = `${category} ${description}`.toLowerCase();

  if (text.includes('wi-fi') || text.includes('อินเทอร์เน็ต') || text.includes('เน็ต')) {
    return {
      rootCause:
        'DHCP Lease ขัดข้อง, ไดรเวอร์ Wi-Fi Adapter ค้างในโหมดประหยัดพลังงาน หรือสัญญาณ AP บริเวณจุดใช้งานอ่อน/ชนแชนแนล',
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
      rootCause:
        'Print Spooler Service ค้าง, เซ็นเซอร์ถาดกระดาษสกปรก/กระดาษติดค้าง หรือพอร์ต IP เครื่องพิมพ์เปลี่ยน',
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
      rootCause:
        'หน้าสัมผัส RAM ออกซิไดซ์ทำให้ไม่ผ่าน POST, สายสัญญาณภาพ DisplayPort/HDMI เสีย หรือ Power Supply จ่ายไฟไม่เสถียร',
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
      rootCause:
        'ไฟล์ระบบ Windows เสียหาย, SSD มี Health ต่ำ/พื้นที่เต็ม หรือโปรไฟล์ผู้ใช้/โปรแกรมบัญชีมีไฟล์แคชขัดแย้ง',
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
    rootCause:
      'อุปกรณ์ต่อพ่วงเสื่อมสภาพตามอายุการใช้งาน พอร์ต USB จ่ายไฟไม่นิ่ง หรือไดรเวอร์อุปกรณ์ทำงานผิดพลาด',
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

export function getSafeAiErrorMessage(err: unknown): {
  status: number;
  message: string;
} {
  if (err && typeof err === 'object') {
    const record = err as Record<string, unknown>;
    const status = typeof record.status === 'number' ? record.status : 500;
    const rawMsg =
      typeof record.message === 'string'
        ? record.message
        : 'เกิดข้อผิดพลาดในการเชื่อมต่อ Gemini API';
    if (
      status === 403 ||
      rawMsg.includes('PERMISSION_DENIED') ||
      status === 400 ||
      rawMsg.includes('API_KEY_INVALID')
    ) {
      return {
        status,
        message:
          'API Key ไม่ถูกต้องหรือไม่มีสิทธิ์ใช้งาน กรุณาตรวจสอบค่า GEMINI_API_KEY ใน Settings > Secrets',
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

export async function generateUserTroubleshoot(
  category: string,
  description: string
): Promise<{
  source: 'gemini' | 'fallback';
  model: string;
  notice?: string;
  data: TroubleshootData;
}> {
  const apiKey = getConfiguredApiKey();
  if (!apiKey) {
    return {
      source: 'fallback',
      model: MODEL_NAME,
      notice:
        'ยังไม่ได้ตั้งค่า GEMINI_API_KEY ใน Environment — แสดงผลจากโหมดจำลองคำตอบ (Fallback Mock AI)',
      data: buildFallbackTroubleshoot(category, description),
    };
  }

  const ai = createGeminiClient(apiKey);
  const response = await ai.models.generateContent({
    model: MODEL_NAME,
    contents: `ประเภทปัญหา: ${category}\nรายละเอียดอาการเสียจากผู้ใช้งาน: ${description}`,
    config: {
      maxOutputTokens: MAX_GEMINI_OUTPUT_TOKENS,
      systemInstruction:
        'คุณคือผู้ช่วยฝ่ายไอที (IT Helpdesk) ที่สุภาพและใจดี หน้าที่ของคุณคือช่วยพนักงานออฟฟิศทั่วไปแก้ปัญหาเบื้องต้นด้วยตนเองก่อนส่งซ่อม ตอบเป็นภาษาไทยที่เข้าใจง่าย หลีกเลี่ยงศัพท์เทคนิคที่ซับซ้อน แบ่งขั้นตอนเป็นข้อๆ ไม่เกิน 5 ข้อ ที่ทำตามได้จริงและปลอดภัย ไม่เสี่ยงทำให้อุปกรณ์เสียหาย',
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
            description:
              'ขั้นตอนการแก้ไขด้วยตนเอง 3-5 ข้อ เรียงลำดับจากง่ายไปยาก ไม่ต้องใส่เลขข้อนำหน้า',
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
  return {
    source: 'gemini',
    model: MODEL_NAME,
    data: {
      summary:
        parsed.summary || 'ลองตรวจสอบตามขั้นตอนเบื้องต้นด้านล่างนี้ก่อนแจ้งช่างครับ',
      steps:
        Array.isArray(parsed.steps) && parsed.steps.length > 0
          ? parsed.steps.slice(0, 5)
          : buildFallbackTroubleshoot(category, description).steps,
      warningNote:
        parsed.warningNote || 'กรุณาบันทึกงานสำคัญก่อนรีสตาร์ทเครื่องทุกครั้งครับ',
    },
  };
}

export async function generateAdminDiagnostic(input: {
  ticketId: string;
  department: string;
  assetTag: string;
  urgency: string;
  category: string;
  description: string;
}): Promise<{
  source: 'gemini' | 'fallback';
  model: string;
  notice?: string;
  data: DiagnosticData;
}> {
  const apiKey = getConfiguredApiKey();
  if (!apiKey) {
    return {
      source: 'fallback',
      model: MODEL_NAME,
      notice:
        'ยังไม่ได้ตั้งค่า GEMINI_API_KEY ใน Environment — แสดงผลจากโหมดจำลองคำตอบ (Fallback Mock AI)',
      data: buildFallbackDiagnostic(input.category, input.description),
    };
  }

  const ai = createGeminiClient(apiKey);
  const prompt = [
    `รหัสใบงาน: ${input.ticketId || '-'}`,
    `แผนก: ${input.department || '-'}`,
    `หมายเลขครุภัณฑ์: ${input.assetTag || 'ไม่ระบุ'}`,
    `ความเร่งด่วน: ${input.urgency || '-'}`,
    `ประเภทปัญหา: ${input.category}`,
    `รายละเอียดอาการเสีย: ${input.description}`,
  ].join('\n');

  const response = await ai.models.generateContent({
    model: MODEL_NAME,
    contents: prompt,
    config: {
      maxOutputTokens: MAX_GEMINI_OUTPUT_TOKENS,
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
  const fallback = buildFallbackDiagnostic(input.category, input.description);
  return {
    source: 'gemini',
    model: MODEL_NAME,
    data: {
      rootCause: parsed.rootCause || fallback.rootCause,
      toolsAndParts:
        Array.isArray(parsed.toolsAndParts) && parsed.toolsAndParts.length > 0
          ? parsed.toolsAndParts.slice(0, 6)
          : fallback.toolsAndParts,
      technicalSteps:
        Array.isArray(parsed.technicalSteps) && parsed.technicalSteps.length > 0
          ? parsed.technicalSteps.slice(0, 6)
          : fallback.technicalSteps,
    },
  };
}
