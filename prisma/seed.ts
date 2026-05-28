import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { hash } from 'bcryptjs';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is not set');
}

const pool = new pg.Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter } as any);

async function main() {
  console.log('🌱 Seeding database...');

  // 1. Create Super Admin
  const superAdminPassword = await hash('superadmin123', 12);
  const superAdmin = await prisma.user.upsert({
    where: { username: 'superadmin' },
    update: {},
    create: {
      username: 'superadmin',
      password: superAdminPassword,
      name: 'Super Administrator',
      role: 'SUPER_ADMIN',
      mustChangePassword: false,
    },
  });
  console.log('✅ Super Admin created:', superAdmin.username);

  // 2. Create Tenants
  const upTenant = await prisma.tenant.upsert({
    where: { code: 'up_tshss' },
    update: {},
    create: {
      name: 'TSHSS Punalur - UP Section',
      code: 'up_tshss',
      schoolName: 'TSHSS Punalur',
      section: 'UP',
      academicYear: '2025-2026',
    },
  });

  const hsTenant = await prisma.tenant.upsert({
    where: { code: 'hs_tshss' },
    update: {},
    create: {
      name: 'TSHSS Punalur - HS Section',
      code: 'hs_tshss',
      schoolName: 'TSHSS Punalur',
      section: 'HS',
      academicYear: '2025-2026',
    },
  });
  console.log('✅ Tenants created:', upTenant.code, hsTenant.code);

  // 3. Create School Admins
  const upAdminPwd = await hash('admin_up_123', 12);
  await prisma.user.upsert({
    where: { username: 'admin_up_tshss' },
    update: {},
    create: {
      tenantId: upTenant.id,
      username: 'admin_up_tshss',
      password: upAdminPwd,
      name: 'UP Headmistress',
      role: 'SCHOOL_ADMIN',
      mustChangePassword: true,
      createdById: superAdmin.id,
    },
  });

  const hsAdminPwd = await hash('admin_hs_123', 12);
  await prisma.user.upsert({
    where: { username: 'admin_hs_tshss' },
    update: {},
    create: {
      tenantId: hsTenant.id,
      username: 'admin_hs_tshss',
      password: hsAdminPwd,
      name: 'HS Headmistress',
      role: 'SCHOOL_ADMIN',
      mustChangePassword: true,
      createdById: superAdmin.id,
    },
  });
  console.log('✅ School Admins created');

  // 4. Create HS Subjects
  const hsSubjects = [
    { name: 'Malayalam I', code: 'MAL1', periodsPerWeek: 5, isCore: true, eveningPriority: false, consecutiveSlots: 1 },
    { name: 'Malayalam II', code: 'MAL2', periodsPerWeek: 5, isCore: true, eveningPriority: false, consecutiveSlots: 1 },
    { name: 'English', code: 'ENG', periodsPerWeek: 6, isCore: true, eveningPriority: false, consecutiveSlots: 1 },
    { name: 'Hindi', code: 'HIN', periodsPerWeek: 4, isCore: true, eveningPriority: false, consecutiveSlots: 1 },
    { name: 'Social Science', code: 'SS', periodsPerWeek: 5, isCore: true, eveningPriority: false, consecutiveSlots: 1 },
    { name: 'Physics', code: 'PHY', periodsPerWeek: 4, isCore: true, eveningPriority: false, consecutiveSlots: 1 },
    { name: 'Chemistry', code: 'CHEM', periodsPerWeek: 4, isCore: true, eveningPriority: false, consecutiveSlots: 1 },
    { name: 'Biology', code: 'BIO', periodsPerWeek: 4, isCore: true, eveningPriority: false, consecutiveSlots: 1 },
    { name: 'Mathematics', code: 'MATH', periodsPerWeek: 6, isCore: true, eveningPriority: false, consecutiveSlots: 1 },
    { name: 'Work Experience', code: 'WE', periodsPerWeek: 2, isCore: false, eveningPriority: true, consecutiveSlots: 1 },
    { name: 'Art', code: 'ART', periodsPerWeek: 1, isCore: false, eveningPriority: true, consecutiveSlots: 1 },
    { name: 'Physical Education', code: 'PE', periodsPerWeek: 2, isCore: false, eveningPriority: true, consecutiveSlots: 1 },
    { name: 'IT Practical', code: 'ITP', periodsPerWeek: 2, isCore: false, eveningPriority: true, consecutiveSlots: 2 },
    { name: 'IT Theory', code: 'ITT', periodsPerWeek: 1, isCore: false, eveningPriority: false, consecutiveSlots: 1 },
    { name: 'Recreation', code: 'REC', periodsPerWeek: 1, isCore: false, eveningPriority: true, consecutiveSlots: 1 },
  ];

  for (const sub of hsSubjects) {
    await prisma.subject.upsert({
      where: { tenantId_code: { tenantId: hsTenant.id, code: sub.code } },
      update: {},
      create: { tenantId: hsTenant.id, ...sub },
    });
  }

  // HS Language variants
  const hsMal1 = await prisma.subject.findUnique({ where: { tenantId_code: { tenantId: hsTenant.id, code: 'MAL1' } } });
  if (hsMal1) {
    for (const variant of [
      { name: 'Sanskrit', code: 'SANS' },
      { name: 'Arabic', code: 'ARAB' },
    ]) {
      await prisma.subject.upsert({
        where: { tenantId_code: { tenantId: hsTenant.id, code: variant.code } },
        update: {},
        create: {
          tenantId: hsTenant.id, name: variant.name, code: variant.code,
          periodsPerWeek: 5, isCore: true, eveningPriority: false, consecutiveSlots: 1,
          isLanguageVariant: true, replacesSubjectId: hsMal1.id,
        },
      });
    }
  }

  // 5. Create UP Subjects
  const upSubjects = [
    { name: 'English', code: 'ENG', periodsPerWeek: 6, isCore: true, eveningPriority: false, consecutiveSlots: 1 },
    { name: 'Malayalam I', code: 'MAL1', periodsPerWeek: 6, isCore: true, eveningPriority: false, consecutiveSlots: 1 },
    { name: 'Malayalam II', code: 'MAL2', periodsPerWeek: 5, isCore: true, eveningPriority: false, consecutiveSlots: 1 },
    { name: 'Hindi', code: 'HIN', periodsPerWeek: 5, isCore: true, eveningPriority: false, consecutiveSlots: 1 },
    { name: 'Social Science', code: 'SS', periodsPerWeek: 5, isCore: true, eveningPriority: false, consecutiveSlots: 1 },
    { name: 'Basic Science', code: 'BS', periodsPerWeek: 5, isCore: true, eveningPriority: false, consecutiveSlots: 1 },
    { name: 'Mathematics', code: 'MATH', periodsPerWeek: 6, isCore: true, eveningPriority: false, consecutiveSlots: 1 },
    { name: 'Work Experience', code: 'WE', periodsPerWeek: 2, isCore: false, eveningPriority: true, consecutiveSlots: 1 },
    { name: 'Art', code: 'ART', periodsPerWeek: 1, isCore: false, eveningPriority: true, consecutiveSlots: 1 },
    { name: 'Physical Education', code: 'PE', periodsPerWeek: 2, isCore: false, eveningPriority: true, consecutiveSlots: 1 },
    { name: 'IT', code: 'IT', periodsPerWeek: 2, isCore: false, eveningPriority: true, consecutiveSlots: 1 },
    { name: 'Recreation', code: 'REC', periodsPerWeek: 1, isCore: false, eveningPriority: true, consecutiveSlots: 1 },
    { name: 'Library', code: 'LIB', periodsPerWeek: 1, isCore: false, eveningPriority: true, consecutiveSlots: 1 },
  ];

  for (const sub of upSubjects) {
    await prisma.subject.upsert({
      where: { tenantId_code: { tenantId: upTenant.id, code: sub.code } },
      update: {},
      create: { tenantId: upTenant.id, ...sub },
    });
  }

  // UP Language variants
  const upMal1 = await prisma.subject.findUnique({ where: { tenantId_code: { tenantId: upTenant.id, code: 'MAL1' } } });
  if (upMal1) {
    for (const variant of [
      { name: 'Sanskrit', code: 'SANS' },
      { name: 'Arabic', code: 'ARAB' },
      { name: 'Urdu', code: 'URDU' },
    ]) {
      await prisma.subject.upsert({
        where: { tenantId_code: { tenantId: upTenant.id, code: variant.code } },
        update: {},
        create: {
          tenantId: upTenant.id, name: variant.name, code: variant.code,
          periodsPerWeek: 6, isCore: true, eveningPriority: false, consecutiveSlots: 1,
          isLanguageVariant: true, replacesSubjectId: upMal1.id,
        },
      });
    }
  }

  console.log('✅ Subjects created for both tenants');
  console.log('\n📋 Login Credentials:');
  console.log('   Super Admin: superadmin / superadmin123');
  console.log('   UP Admin: admin_up_tshss / admin_up_123');
  console.log('   HS Admin: admin_hs_tshss / admin_hs_123');
  console.log('\n🎉 Seed complete!');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
