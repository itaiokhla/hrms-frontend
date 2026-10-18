export interface SettingsData {
  companyName?: string;
  companyEmail?: string;
  companyPhone?: string;
  companyAddress?: string;

  checkIn?: string;
  checkOut?: string;
  graceTime?: number;

  threshold?: number;
  autoAttendance?: boolean;
  voiceWelcome?: boolean;

  pf?: number;
  tax?: number;
  overtime?: number;

  darkMode?: boolean;
  emailNotification?: boolean;
  autoBackup?: boolean;

  [key: string]: string | number | boolean | undefined;
}

export interface LogoUploadResponse {
  success: boolean;
  logo: string;
}