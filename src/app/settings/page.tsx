'use client';

import { useState } from 'react';
import BackButton from "@/components/BackButton";
import { useEffect } from "react";
import settingsService from "@/services/settings";
import { ImageIcon, Upload } from "lucide-react";
import {
  Building2,
  Clock,
  ScanFace,
  DollarSign,
  Settings,
  Save
} from "lucide-react";

export default function SettingsPage() {
const [logo, setLogo] = useState<File | null>(null);
const [logoPreview, setLogoPreview] = useState<string>("");
const [saving, setSaving] = useState(false);

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL!.replace("/api/v1", "");

const uploadLogo = async () => {
  if (!logo) {
    alert("Please select a logo first.");
    return;
  }

  try {
    const res = await settingsService.uploadLogo(logo);
    console.log("UPLOAD RESPONSE:", res);

    if (res.success && res.logo) {
      setLogoPreview(
      `${API_BASE_URL}/uploads/company-logo.png?${Date.now()}`
    );
      alert("✅ Logo uploaded successfully");
    } else {
      alert("❌ Unexpected response from server");
    }

  } catch (err) {
    console.error(err);
    alert("❌ Logo upload failed");
  }
};

const [settings, setSettings] = useState({
  companyName: "Mayank Technologies",
  companyEmail: "admin@company.com",
  companyPhone: "+91 9876543210",
  companyAddress: "Agra, Uttar Pradesh",

  checkIn: "09:00",
  checkOut: "18:00",
  graceTime: 15,

  threshold: 80,
  autoAttendance: true,
  voiceWelcome: true,

  pf: 12,
  tax: 10,
  overtime: 150,

  theme: "light",
  emailNotification: true,
  autoBackup: true,
});

useEffect(() => {

  loadSettings();

}, []);

useEffect(() => {

  document.body.classList.remove("light", "dark");

  document.body.classList.add(settings.theme);

}, [settings.theme]);

const loadSettings = async () => {

  try {

    const data = await settingsService.getSettings();

    setSettings((prev) => ({
      ...prev,
      ...data,
    }));

    if (data.theme) {
    document.body.classList.remove("light", "dark");
    document.body.classList.add(data.theme as string);
}

    if (data.companyLogo) {
        setLogoPreview(
          `${API_BASE_URL}${data.companyLogo}`
        );
      }

  } catch (error) {

    console.log(error);

  }

};

useEffect(() => {

  document.body.classList.remove(
    "light",
    "dark"
  );

  document.body.classList.add(settings.theme);

}, [settings.theme]);

const saveSettings = async () => {
  if (!settings.companyName.trim()) {
    alert("Company name is required");
    return;
  }

  if (!settings.companyEmail.trim()) {
    alert("Company email is required");
    return;
  }

  if (settings.graceTime < 0) {
    alert("Grace time cannot be negative");
    return;
  }

  if (settings.pf < 0 || settings.tax < 0) {
    alert("PF and Tax must be valid");
    return;
  }

  try {
    setSaving(true);

    await settingsService.saveSettings(settings);

    alert("✅ Settings Saved Successfully");
  } catch (error) {
    console.error(error);
    alert("❌ Failed to Save Settings");
  } finally {
    setSaving(false);
  }
};
return (
  <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-100 p-8">

      <div className="mb-6">

    <BackButton />

    </div>

    {/* Header */}

    <div className="rounded-3xl bg-white p-6 shadow-lg transition hover:-translate-y-1 hover:shadow-2xl">
  <div className="mb-6 flex items-center gap-3">
    <ImageIcon className="text-blue-600" size={28} />
    <h2 className="text-2xl font-bold">
      Company Logo
    </h2>
  </div>

  <div className="space-y-4">

    {logoPreview && (
      <img
        src={logoPreview}
        alt="Company Logo"
        className="h-40 w-40 rounded-2xl border-2 border-dashed border-blue-300 object-contain p-4"
      />
    )}

    <input
      type="file"
      accept="image/*"
      onChange={(e) => {
        if (e.target.files?.length) {
          setLogo(e.target.files[0]);
          setLogoPreview(
            URL.createObjectURL(e.target.files[0])
          );
        }
      }}
    />

    <button
      onClick={uploadLogo}
      className="flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-white hover:bg-blue-700"
    >
      <Upload size={18} />
      Upload Logo
    </button>

  </div>
</div>

    <div className="mb-8 rounded-3xl bg-gradient-to-r from-blue-600 to-indigo-700 p-8 text-white shadow-xl">

      <h1 className="text-4xl font-bold">
        System Settings
      </h1>

      <p className="mt-2 text-blue-100">
        Configure company, attendance, payroll and AI settings
      </p>

    </div>

    <div className="grid gap-6 lg:grid-cols-2">

      {/* Company Settings */}

      <div className="rounded-3xl bg-white p-6 shadow-lg transition hover:-translate-y-1 hover:shadow-2xl">

        <div className="mb-6 flex items-center gap-3">

          <Building2 className="text-blue-600" size={28} />

          <h2 className="text-2xl font-bold">
            Company Settings
          </h2>

        </div>

        <div className="space-y-4">

          <input
            type="text"
            placeholder="Company Name"
            value={settings.companyName}
            onChange={(e) =>
              setSettings({
                ...settings,
                companyName: e.target.value,
              })
            }
            className="w-full rounded-xl border p-3"
          />

          <input
            type="email"
            placeholder="Company Email"
            value={settings.companyEmail}
            onChange={(e) =>
              setSettings({
                ...settings,
                companyEmail: e.target.value,
              })
            }
            className="w-full rounded-xl border p-3"
          />

          <input
            type="text"
            placeholder="Company Phone"
            value={settings.companyPhone}
            onChange={(e) =>
              setSettings({
                ...settings,
                companyPhone: e.target.value,
              })
            }
            className="w-full rounded-xl border p-3"
          />

          <textarea
            rows={3}
            placeholder="Company Address"
            value={settings.companyAddress}
            onChange={(e) =>
              setSettings({
                ...settings,
                companyAddress: e.target.value,
              })
            }
            className="w-full rounded-xl border p-3"
          />

        </div>

      </div>
            {/* Attendance Settings */}

      <div className="rounded-3xl bg-white p-6 shadow-lg transition hover:-translate-y-1 hover:shadow-2xl">

        <div className="mb-6 flex items-center gap-3">

          <Clock className="text-green-600" size={28} />

          <h2 className="text-2xl font-bold">
            Attendance Settings
          </h2>

        </div>

        <div className="space-y-4">

          <div>
            <label className="mb-2 block font-medium">
              Check In Time
            </label>

            <input
              type="time"
              value={settings.checkIn}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  checkIn: e.target.value,
                })
              }
              className="w-full rounded-xl border p-3"
            />
          </div>

          <div>
            <label className="mb-2 block font-medium">
              Check Out Time
            </label>

            <input
              type="time"
              value={settings.checkOut}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  checkOut: e.target.value,
                })
              }
              className="w-full rounded-xl border p-3"
            />
          </div>

          <div>
            <label className="mb-2 block font-medium">
              Grace Time (Minutes)
            </label>

            <input
              type="number"
              value={settings.graceTime}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  graceTime: Number(e.target.value),
                })
              }
              className="w-full rounded-xl border p-3"
            />
          </div>

        </div>

      </div>

      {/* Face Recognition Settings */}

      <div className="rounded-3xl bg-white p-6 shadow-lg transition hover:-translate-y-1 hover:shadow-2xl">

        <div className="mb-6 flex items-center gap-3">

          <ScanFace className="text-purple-600" size={28} />

          <h2 className="text-2xl font-bold">
            Face Recognition
          </h2>

        </div>

        <div className="space-y-5">

          <div>

            <label className="mb-2 block font-medium">
              Recognition Threshold
            </label>

            <input
              type="range"
              min="50"
              max="100"
              value={settings.threshold}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  threshold: Number(e.target.value),
                })
              }
              className="w-full"
            />

            <p className="mt-2 font-semibold text-blue-600">
              {settings.threshold}%
            </p>

          </div>

          

          <label className="flex items-center justify-between rounded-xl border p-4">

            <span>Voice Welcome</span>

            <input
              type="checkbox"
              checked={settings.voiceWelcome}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  voiceWelcome: e.target.checked,
                })
              }
            />

          </label>

        </div>

      </div>
            {/* Payroll Settings */}

      <div className="rounded-3xl bg-white p-6 shadow-lg transition hover:-translate-y-1 hover:shadow-2xl">

        <div className="mb-6 flex items-center gap-3">

          <DollarSign className="text-green-600" size={28} />

          <h2 className="text-2xl font-bold">
            Payroll Settings
          </h2>

        </div>

        <div className="space-y-4">

          <div>
            <label className="mb-2 block font-medium">
              PF Percentage
            </label>

            <input
              type="number"
              value={settings.pf}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  pf: Number(e.target.value),
                })
              }
              className="w-full rounded-xl border p-3"
            />
          </div>

          <div>
            <label className="mb-2 block font-medium">
              Tax Percentage
            </label>

            <input
              type="number"
              value={settings.tax}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  tax: Number(e.target.value),
                })
              }
              className="w-full rounded-xl border p-3"
            />
          </div>

          <div>
            <label className="mb-2 block font-medium">
              Overtime Rate (₹ / Hour)
            </label>

            <input
              type="number"
              value={settings.overtime}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  overtime: Number(e.target.value),
                })
              }
              className="w-full rounded-xl border p-3"
            />
          </div>

        </div>

      </div>

      {/* System Settings */}

      <div className="rounded-3xl bg-white p-6 shadow-lg transition hover:-translate-y-1 hover:shadow-2xl">

        <div className="mb-6 flex items-center gap-3">

          <Settings className="text-gray-700" size={28} />

          <h2 className="text-2xl font-bold">
            System Settings
          </h2>

        </div>

        <div className="space-y-5">

          <label className="flex items-center justify-between rounded-xl border p-4">
            <span>Dark Mode</span>

            <input
              type="checkbox"
              checked={settings.theme === "dark"}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  theme: e.target.checked ? "dark" : "light",
                })
              }
            />
          </label>

          <label className="flex items-center justify-between rounded-xl border p-4">
            <span>Email Notifications</span>

            <input
              type="checkbox"
              checked={settings.emailNotification}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  emailNotification: e.target.checked,
                })
              }
            />
          </label>

          <label className="flex items-center justify-between rounded-xl border p-4">
            <span>Auto Backup</span>

            <input
              type="checkbox"
              checked={settings.autoBackup}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  autoBackup: e.target.checked,
                })
              }
            />
          </label>

        </div>

      </div>

    </div>

    {/* Save Button */}

    <div className="mt-8 flex justify-end">
  <button
    onClick={saveSettings}
    disabled={saving}
    className="flex items-center gap-2 rounded-xl bg-blue-600 px-6 py-3 font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
  >
    <Save size={20} />
    {saving ? "Saving..." : "Save Settings"}
  </button>
</div>

<div className="mt-10 text-center text-sm text-gray-500">
  Salary Management System © 2026
</div>

</div>
);
}