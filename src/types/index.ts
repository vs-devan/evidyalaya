export type UserRole = 'SUPER_ADMIN' | 'SCHOOL_ADMIN' | 'TEACHER' | 'PARENT';

export interface TenantData {
  id: string;
  name: string;
  code: string;
  schoolName: string;
  section: string;
  academicYear: string;
  isActive: boolean;
}

export interface UserData {
  id: string;
  username: string;
  name: string;
  role: UserRole;
  email?: string;
  phone?: string;
  isActive: boolean;
  mustChangePassword: boolean;
  tenantId?: string;
  tenant?: TenantData;
}

export interface TeacherData {
  id: string;
  userId: string;
  teacherCode: string;
  penNo?: string;
  designation: string;
  user: UserData;
  subjectMappings: TeacherSubjectData[];
  classTeacherOf?: DivisionData;
}

export interface TeacherSubjectData {
  id: string;
  subjectId: string;
  subject: SubjectData;
}

export interface ClassData {
  id: string;
  name: string;
  order: number;
  tenantId: string;
  divisions: DivisionData[];
}

export interface DivisionData {
  id: string;
  name: string;
  classId: string;
  classTeacherId?: string;
  classTeacher?: TeacherData;
  class?: ClassData;
}

export interface SubjectData {
  id: string;
  name: string;
  code: string;
  periodsPerWeek: number;
  isCore: boolean;
  eveningPriority: boolean;
  consecutiveSlots: number;
  isLanguageVariant: boolean;
  replacesSubjectId?: string;
  tenantId: string;
}

export interface StudentData {
  id: string;
  rollNumber: number;
  name: string;
  parentName?: string;
  parentPhone?: string;
  divisionId: string;
  userId: string;
  division?: DivisionData;
}

export interface TimetableEntryData {
  id: string;
  divisionId: string;
  dayOfWeek: number;
  slotNumber: number;
  subjectId: string;
  teacherId: string;
  subject?: SubjectData;
  teacher?: TeacherData;
  division?: DivisionData;
}

export interface AttendanceData {
  id: string;
  studentId: string;
  date: string;
  isPresent: boolean;
  student?: StudentData;
}

export interface ExamResultData {
  id: string;
  studentId: string;
  subjectId: string;
  examName: string;
  marks?: number;
  grade?: string;
  maxMarks: number;
  subject?: SubjectData;
  student?: StudentData;
}

export interface MessageData {
  id: string;
  content: string;
  targetType: string;
  targetClassDivisionId?: string;
  senderId: string;
  sender?: UserData;
  createdAt: string;
  attachments: string[];
}

export interface SubstituteData {
  id: string;
  date: string;
  absentTeacherId: string;
  originalSlotNumber: number;
  originalDivisionId: string;
  substituteTeacherId: string;
  absentTeacher?: TeacherData;
  substituteTeacher?: TeacherData;
  originalDivision?: DivisionData;
}

export interface CertificateData {
  id: string;
  type: string;
  generatedForId: string;
  content: string;
  attachments: string[];
  metadata?: any;
  createdAt: string;
  generatedFor?: TeacherData;
}

export const FEATURES = [
  'TIMETABLE',
  'SUBSTITUTE',
  'ATTENDANCE',
  'RESULTS',
  'CERTIFICATES',
  'MESSAGES',
  'STUDENTS',
  'TEACHERS',
] as const;

export type Feature = typeof FEATURES[number];
