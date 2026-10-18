"use client";

import { useEffect, useState, useRef } from "react";
import {
  User,
  Mail,
  Phone,
  Building2,
  Briefcase,
  Loader2,
  Camera,
  Pencil,
} from "lucide-react";
import BackButton from "@/components/BackButton";

import employeeService from "@/services/employeeService";
import { EmployeeProfile } from "@/types/employee";
import authService from "@/services/auth";
import { Save } from "lucide-react";
import toast from "react-hot-toast";

export default function EmployeeProfilePage() {
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<EmployeeProfile | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const BACKEND_URL =
  process.env.NEXT_PUBLIC_API_URL?.replace("/api/v1", "") ||
  "http://localhost:8000";

  const [formData, setFormData] = useState({
  phone: "",
  address: "",
  city: "",
  state: "",
  postal_code: "",
  country: "",
});

const [passwordOpen, setPasswordOpen] = useState(false);

const [passwordData, setPasswordData] = useState({
  current_password: "",
  new_password: "",
  confirm_password: "",
});

const [changingPassword, setChangingPassword] = useState(false);

  useEffect(() => {
    fetchProfile();
  }, []);

  const fetchProfile = async () => {
    try {
      setLoading(true);

      const data = await employeeService.getProfile();

      setProfile(data);

      setFormData({
        phone: data.phone || "",
        address: data.address || "",
        city: data.city || "",
        state: data.state || "",
        postal_code: data.postal_code || "",
        country: data.country || "",
        });
    } catch (error) {
      console.error("Failed to load profile", error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
  try {
    setSaving(true);

    await employeeService.updateProfile({
      phone: formData.phone,
      address: formData.address,
      city: formData.city,
      state: formData.state,
      postal_code: formData.postal_code,
      country: formData.country,
    });

    toast.success("Profile updated successfully");

    await fetchProfile();

    setEditOpen(false);

  } catch (error) {
    console.error(error);

    toast.error("Failed to update profile");
  } finally {
    setSaving(false);
  }
};

const handlePhotoUpload = async (
  e: React.ChangeEvent<HTMLInputElement>
) => {
  const file = e.target.files?.[0];

  if (!file) return;

  try {
    await employeeService.uploadProfilePhoto(file);

    toast.success("Profile photo updated successfully");

    await fetchProfile();

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }

  } catch (error) {
    console.error("Photo upload failed:", error);

    toast.error("Failed to upload photo");
  }
};

const handleChangePassword = async () => {
  if (!passwordData.current_password) {
    toast.error("Current password is required");
    return;
  }

  if (!passwordData.new_password) {
    toast.error("New password is required");
    return;
  }

  if (passwordData.new_password.length < 8) {
    toast.error("Password must be at least 8 characters");
    return;
  }

  if (passwordData.new_password !== passwordData.confirm_password) {
    toast.error("Passwords do not match");
    return;
  }

  try {
    setChangingPassword(true);

    await authService.changePassword(
      passwordData.current_password,
      passwordData.new_password
    );

    toast.success("Password changed successfully");

    setPasswordData({
      current_password: "",
      new_password: "",
      confirm_password: "",
    });

    setPasswordOpen(false);

  } catch (error: any) {
    console.error(error);

    toast.error(
      error?.response?.data?.detail ||
      "Failed to change password"
    );
  } finally {
    setChangingPassword(false);
  }
};



  if (loading) {
    return (
      <div className="flex justify-center items-center h-[70vh]">
        <Loader2 className="w-10 h-10 animate-spin text-blue-600" />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="text-center py-20 text-red-500">
        Unable to load profile.
      </div>
    );
  }

  console.log("passwordOpen =", passwordOpen);

  return (
    <div className="p-6 space-y-6">

      {/* Header */}

      <div>
        <BackButton />

          <div>
            <h1 className="text-3xl font-bold">
              Dashboard
            </h1>
            <p className="text-gray-500">
              Welcome back
            </p>
          </div>
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
          My Profile
        </h1>

        <p className="text-gray-500 dark:text-gray-400">
          View and manage your profile information
        </p>
      </div>

      {/* Profile Card */}

      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-lg p-8">

        <div className="flex flex-col md:flex-row items-center gap-8">

          {/* Avatar */}

          <div className="relative">

            <div className="w-36 h-36 rounded-full bg-blue-100 flex items-center justify-center overflow-hidden">

              {profile.photo_url ? (
                <img
                  src={
                    profile.photo_url
                      ? `${BACKEND_URL}${profile.photo_url}`
                      : ""
                  }
                  alt="Profile"
                  className="w-full h-full object-cover"
                />
              ) : (
                <User className="w-16 h-16 text-blue-600" />
              )}

            </div>

            <button
                onClick={() => fileInputRef.current?.click()}
                className="
                    absolute bottom-1 right-1
                    bg-blue-600 hover:bg-blue-700
                    text-white rounded-full p-2 shadow-lg
                "
                >
                <Camera size={18} />
                </button>
                <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handlePhotoUpload}
                    />

          </div>

          {/* Basic Info */}

          <div className="flex-1">

            <h2 className="text-3xl font-bold text-gray-900 dark:text-white">

              {profile.first_name} {profile.last_name}

            </h2>

            <p className="text-lg text-blue-600 mt-2">

              {profile.position || "Employee"}

            </p>

            <div className="flex flex-wrap gap-6 mt-6">

              <div className="flex items-center gap-2">

                <Mail size={18} />

                <span>{profile.email}</span>

              </div>

              <div className="flex items-center gap-2">

                <Phone size={18} />

                <span>{profile.phone || "-"}</span>

              </div>

              <div className="flex items-center gap-2">

                <Building2 size={18} />

                <span>{profile.department || "-"}</span>

              </div>

              <div className="flex items-center gap-2">

                <Briefcase size={18} />

                <span>{profile.position || "-"}</span>

              </div>

            </div>

          </div>

          {/* Edit Button */}

          <button
            onClick={() => setEditOpen(true)}
            className="
                flex items-center gap-2
                bg-blue-600
                hover:bg-blue-700
                text-white
                px-5
                py-3
                rounded-xl
            "
            >
            <Pencil size={18} />
            Edit Profile
            </button>
            <button
              onClick={() => {
                console.log("Change Password Clicked");
                setPasswordOpen(true);
              }}
              className="px-5 py-3 rounded-xl bg-gray-700 hover:bg-gray-800 text-white"
            >
              Change Password
            </button>
        </div>

      </div>
      {/* Personal & Work Information */}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Personal Information */}

        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-lg p-6">

            <h2 className="text-xl font-bold mb-6 text-gray-900 dark:text-white">
            Personal Information
            </h2>

            <div className="space-y-5">

            <div className="flex justify-between border-b pb-3">
                <span className="text-gray-500">Employee ID</span>
                <span className="font-semibold">{profile.employee_id}</span>
            </div>

            <div className="flex justify-between border-b pb-3">
                <span className="text-gray-500">Full Name</span>
                <span className="font-semibold">
                {profile.first_name} {profile.last_name}
                </span>
            </div>

            <div className="flex justify-between border-b pb-3">
                <span className="text-gray-500">Email</span>
                <span className="font-semibold">{profile.email}</span>
            </div>

            <div className="flex justify-between border-b pb-3">
                <span className="text-gray-500">Phone</span>
                <span className="font-semibold">
                {profile.phone || "-"}
                </span>
            </div>

            <div className="flex justify-between border-b pb-3">
                <span className="text-gray-500">Gender</span>
                <span className="font-semibold">
                {profile.gender || "-"}
                </span>
            </div>

            <div className="flex justify-between">
                <span className="text-gray-500">Date of Birth</span>
                <span className="font-semibold">
                {profile.date_of_birth || "-"}
                </span>
            </div>

            </div>

        </div>

        {/* Work Information */}

        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-lg p-6">

            <h2 className="text-xl font-bold mb-6 text-gray-900 dark:text-white">
            Work Information
            </h2>

            <div className="space-y-5">

            <div className="flex justify-between border-b pb-3">
                <span className="text-gray-500">Department</span>
                <span className="font-semibold">
                {profile.department || "-"}
                </span>
            </div>

            <div className="flex justify-between border-b pb-3">
                <span className="text-gray-500">Position</span>
                <span className="font-semibold">
                {profile.position || "-"}
                </span>
            </div>

            <div className="flex justify-between border-b pb-3">
                <span className="text-gray-500">Shift</span>
                <span className="font-semibold">
                {profile.shift || "-"}
                </span>
            </div>

            <div className="flex justify-between">
                <span className="text-gray-500">Joining Date</span>
                <span className="font-semibold">
                {profile.hire_date || "-"}
                </span>
            </div>

            </div>

        </div>
        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-lg p-6">

            <h2 className="text-xl font-bold mb-6 text-gray-900 dark:text-white">
                Address Information
            </h2>

            <div className="space-y-5">

                <div className="flex justify-between border-b pb-3">
                <span className="text-gray-500">Address</span>
                <span className="font-semibold">
                    {profile.address || "-"}
                </span>
                </div>

                <div className="flex justify-between border-b pb-3">
                <span className="text-gray-500">City</span>
                <span className="font-semibold">
                    {profile.city || "-"}
                </span>
                </div>

                <div className="flex justify-between border-b pb-3">
                <span className="text-gray-500">State</span>
                <span className="font-semibold">
                    {profile.state || "-"}
                </span>
                </div>

                <div className="flex justify-between border-b pb-3">
                <span className="text-gray-500">Postal Code</span>
                <span className="font-semibold">
                    {profile.postal_code || "-"}
                </span>
                </div>

                <div className="flex justify-between">
                <span className="text-gray-500">Country</span>
                <span className="font-semibold">
                    {profile.country || "-"}
                </span>
                </div>

        </div>

        </div>

        </div>
        {editOpen && (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">

                <div className="bg-white dark:bg-gray-900 rounded-2xl p-8 w-full max-w-lg">

                <h2 className="text-2xl font-bold mb-6">
                    Edit Profile
                </h2>

                <div className="space-y-4">

                    <input
                    className="w-full border rounded-lg p-3"
                    placeholder="Phone"
                    value={formData.phone}
                    onChange={(e) =>
                        setFormData({
                        ...formData,
                        phone: e.target.value,
                        })
                    }
                    />

                    <textarea
                    className="w-full border rounded-lg p-3"
                    placeholder="Address"
                    value={formData.address}
                    onChange={(e) =>
                        setFormData({
                        ...formData,
                        address: e.target.value,
                        })
                    }
                    />

                    <input
                    className="w-full border rounded-lg p-3"
                    placeholder="City"
                    value={formData.city}
                    onChange={(e) =>
                        setFormData({
                        ...formData,
                        city: e.target.value,
                        })
                    }
                    />

                    <input
                    className="w-full border rounded-lg p-3"
                    placeholder="State"
                    value={formData.state}
                    onChange={(e) =>
                        setFormData({
                        ...formData,
                        state: e.target.value,
                        })
                    }
                    />

                    <input
                    className="w-full border rounded-lg p-3"
                    placeholder="Postal Code"
                    value={formData.postal_code}
                    onChange={(e) =>
                        setFormData({
                        ...formData,
                        postal_code: e.target.value,
                        })
                    }
                    />

                    <input
                    className="w-full border rounded-lg p-3"
                    placeholder="Country"
                    value={formData.country}
                    onChange={(e) =>
                        setFormData({
                        ...formData,
                        country: e.target.value,
                        })
                    }
                    />

                </div>

                <div className="flex justify-end gap-3 mt-8">

                    <button
                    onClick={() => {
                        setFormData({
                            phone: profile.phone || "",
                            address: profile.address || "",
                            city: profile.city || "",
                            state: profile.state || "",
                            postal_code: profile.postal_code || "",
                            country: profile.country || "",
                        });

                        setEditOpen(false);
                        }}
                    className="px-5 py-2 rounded-lg border"
                    >
                    Cancel
                    </button>

                    <button
                        onClick={handleSave}
                        disabled={saving}
                        className="
                            px-5
                            py-2
                            rounded-lg
                            bg-blue-600
                            hover:bg-blue-700
                            text-white
                            disabled:opacity-50
                            flex
                            items-center
                            gap-2
                        "
                        >
                        {saving ? (
                            <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Saving...
                            </>
                        ) : (
                            <>
                            <Save size={16} />
                            Save Changes
                            </>
                        )}
                        </button>

                </div>

                </div>

            </div>
            )} 

            {passwordOpen && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white dark:bg-gray-900 rounded-2xl p-8 w-full max-w-md">

              <h2 className="text-2xl font-bold mb-6">
                Change Password
              </h2>

              <div className="space-y-4">

                <input
                  type="password"
                  placeholder="Current Password"
                  className="w-full border rounded-lg p-3"
                  value={passwordData.current_password}
                  onChange={(e) =>
                    setPasswordData({
                      ...passwordData,
                      current_password: e.target.value,
                    })
                  }
                />

                <input
                  type="password"
                  placeholder="New Password"
                  className="w-full border rounded-lg p-3"
                  value={passwordData.new_password}
                  onChange={(e) =>
                    setPasswordData({
                      ...passwordData,
                      new_password: e.target.value,
                    })
                  }
                />

                <input
                  type="password"
                  placeholder="Confirm Password"
                  className="w-full border rounded-lg p-3"
                  value={passwordData.confirm_password}
                  onChange={(e) =>
                    setPasswordData({
                      ...passwordData,
                      confirm_password: e.target.value,
                    })
                  }
                />

              </div>

              <div className="flex justify-end gap-3 mt-6">

                <button
                  onClick={() => setPasswordOpen(false)}
                  className="px-5 py-2 rounded-lg border"
                >
                  Cancel
                </button>

                <button
                  onClick={handleChangePassword}
                  disabled={changingPassword}
                  className="px-5 py-2 rounded-lg bg-blue-600 text-white disabled:opacity-50"
                >
                  {changingPassword ? "Changing..." : "Change Password"}
                </button>

              </div>

            </div>
          </div>
        )} 

    </div>
  );
}