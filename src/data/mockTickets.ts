import { RepairTicket } from '../types/ticket';

function hoursAgoIso(hours: number): string {
  const date = new Date(Date.now() - hours * 60 * 60 * 1000);
  return date.toISOString();
}

function sameDayMinutesAgoIso(minutes: number): string {
  const now = new Date();
  const target = new Date(now.getTime() - minutes * 60 * 1000);
  if (target.getDate() !== now.getDate()) {
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 8, 30, 0);
    return startOfToday.toISOString();
  }
  return target.toISOString();
}

export function createInitialMockTickets(): RepairTicket[] {
  const t1Created = sameDayMinutesAgoIso(35);
  const t2Created = sameDayMinutesAgoIso(110);
  const t3Created = hoursAgoIso(6);
  const t4Created = hoursAgoIso(26);
  const t5Created = hoursAgoIso(52);
  const t5Completed = hoursAgoIso(47);

  return [
    {
      id: 'IT-2026-005',
      requesterName: 'พิมพ์ชนก วัฒนากูล',
      department: 'ขาย',
      contactInfo: 'ต่อ 214 · LINE: pim.sale',
      category: 'ปริ้นเตอร์/สแกนเนอร์',
      urgency: 'ด่วนมาก - ทำงานต่อไม่ได้',
      description:
        'ปริ้นเตอร์ไม่ออก สั่งพิมพ์ใบเสนอราคาจากเครื่องฝ่ายขายแล้วคิวงานค้าง ขึ้นไฟกระพริบสีส้มที่ถาดกระดาษ',
      assetTag: 'IT-PRT-018',
      status: 'รอดำเนินการ',
      resolutionNote: '',
      createdAt: t1Created,
      updatedAt: t1Created,
      completedAt: null,
    },
    {
      id: 'IT-2026-004',
      requesterName: 'กิตติภพ สุขสวัสดิ์',
      department: 'การตลาด',
      contactInfo: 'ต่อ 308 · LINE: kittipop.mkt',
      category: 'อินเทอร์เน็ต/Wi-Fi มีปัญหา',
      urgency: 'ด่วน',
      description:
        'เชื่อมต่อ Wi-Fi ไม่ได้ โน้ตบุ๊กหลุดจากเครือข่าย Office-5G ทุก 10 นาที ขึ้นข้อความ No Internet, Secured',
      assetTag: 'IT-NB-087',
      status: 'รอดำเนินการ',
      resolutionNote: '',
      createdAt: t2Created,
      updatedAt: t2Created,
      completedAt: null,
    },
    {
      id: 'IT-2026-003',
      requesterName: 'ณัฐธิดา จันทร์เพ็ญ',
      department: 'บัญชี',
      contactInfo: 'ต่อ 112 · LINE: nat.acc',
      category: 'ลง Windows/โปรแกรมใหม่',
      urgency: 'ด่วน',
      description:
        'เครื่องค้างบ่อย ขอลง Windows ใหม่ พร้อมสำรองไฟล์โปรแกรมบัญชี Express และติดตั้ง Microsoft Office ให้กลับมาใช้งานได้ตามปกติ',
      assetTag: 'IT-PC-042',
      status: 'กำลังซ่อม',
      resolutionNote: 'สำรองข้อมูลไดรฟ์ D เรียบร้อย กำลังดำเนินการติดตั้ง Windows 11 Pro และไดรเวอร์',
      createdAt: t3Created,
      updatedAt: sameDayMinutesAgoIso(45),
      completedAt: null,
    },
    {
      id: 'IT-2026-002',
      requesterName: 'วรพล อินทรโชติ',
      department: 'บุคคล',
      contactInfo: 'ต่อ 105 · LINE: worapon.hr',
      category: 'อุปกรณ์ต่อพ่วง เมาส์/คีย์บอร์ด',
      urgency: 'ปกติ',
      description:
        'คีย์บอร์ดปุ่ม Enter และ Backspace กดติดบ้างไม่ติดบ้าง รวมถึงเมาส์ไร้สายคลิกซ้ายเบิ้ลเองบ่อยครั้ง',
      assetTag: 'IT-PC-019',
      status: 'รออะไหล่',
      resolutionNote: 'ตรวจสอบแล้วสวิตช์เสื่อม เบิกชุดคีย์บอร์ดและเมาส์ไร้สายใหม่ รอของเข้าคลังวันพรุ่งนี้',
      createdAt: t4Created,
      updatedAt: hoursAgoIso(18),
      completedAt: null,
    },
    {
      id: 'IT-2026-001',
      requesterName: 'ธนากร ศรีประเสริฐ',
      department: 'ขาย',
      contactInfo: 'ต่อ 220',
      category: 'คอมพิวเตอร์เปิดไม่ติด/จอดำ',
      urgency: 'ด่วนมาก - ทำงานต่อไม่ได้',
      description:
        'เปิดเครื่องแล้วมีเสียงพัดลมหมุนปกติ แต่หน้าจอมืดสนิทไม่มีภาพขึ้นเลย ต้องรีบใช้ข้อมูลส่งลูกค้าช่วงบ่าย',
      assetTag: 'IT-PC-064',
      status: 'เสร็จสิ้น',
      resolutionNote: 'ถอดทำความสะอาดหน้าสัมผัส RAM และเปลี่ยนสาย DisplayPort เส้นใหม่ ทดสอบเปิดใช้งานได้ปกติ',
      createdAt: t5Created,
      updatedAt: t5Completed,
      completedAt: t5Completed,
    },
  ];
}
