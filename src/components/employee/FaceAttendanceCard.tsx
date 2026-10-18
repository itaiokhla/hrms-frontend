'use client';

import { useEffect, useRef, useState } from 'react';
import Webcam from 'react-webcam';
import { toast } from 'react-toastify';
import { LogIn, LogOut } from "lucide-react";

import CameraPreview from './CameraPreview';
import AttendanceStatus from './AttendanceStatus';

import  attendanceService  from '@/services/attendanceService';
import  faceRecognitionService  from '@/services/faceRecognitionService';
import { useAuthStore } from '@/store/authStore';

export default function FaceAttendanceCard() {
  const webcamRef = useRef<Webcam>(null);

  const { user } = useAuthStore();

  const [attendance, setAttendance] = useState({
    status: 'Absent',
    check_in: null as string | null,
    check_out: null as string | null,
    working_hours: '00:00:00',
  });

  const [capturedBlob, setCapturedBlob] = useState<Blob | null>(null);

  const [loading, setLoading] = useState(false);

  const loadAttendance = async () => {
    try {
      const data = await attendanceService.getTodayAttendance();
      setAttendance(data);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    loadAttendance();
  }, []);

  const captureImage = async () => {
    if (!webcamRef.current) {
      toast.error('Camera not available');
      return;
    }

    const screenshot = webcamRef.current.getScreenshot();

    if (!screenshot) {
      toast.error('Unable to capture image');
      return;
    }

    const blob = await (await fetch(screenshot)).blob();

    setCapturedBlob(blob);

    toast.success('Image captured');
  };

  const identifyAndCheckIn = async () => {
  if (!capturedBlob) {
    toast.error("Please capture your face first.");
    return;
  }

  setLoading(true);

  try {
    const identify = await faceRecognitionService.identify(capturedBlob);

    if (!identify.identified) {
      toast.error("Face not recognized");
      return;
    }

    if (identify.email !== user?.email) {
  toast.error("This face does not belong to the logged-in employee.");
  return;
}

    await attendanceService.checkIn(
      identify.employee_id!,
      identify.confidence
    );

    toast.success("Check-In Successful");

    await loadAttendance();
    setCapturedBlob(null);

  } catch (err) {
    toast.error("Check-In Failed");
  } finally {
    setLoading(false);
  }
};

const identifyAndCheckOut = async () => {
  if (!capturedBlob) {
    toast.error("Please capture your face first.");
    return;
  }

  setLoading(true);

  try {
    const identify = await faceRecognitionService.identify(capturedBlob);

    if (!identify.identified) {
      toast.error("Face not recognized");
      return;
    }

    if (identify.email !== user?.email) {
      toast.error("This face does not belong to the logged-in employee.");
      return;
    }

    await attendanceService.checkOut(identify.employee_id!);

    toast.success("Check-Out Successful");

    await loadAttendance();

    setCapturedBlob(null);

  } catch (err) {
    console.error(err);
    toast.error("Check-Out Failed");
  } finally {
    setLoading(false);
  }
};  return (
  <div className="space-y-6">

    <AttendanceStatus
      status={attendance.status}
      checkIn={attendance.check_in}
      checkOut={attendance.check_out}
      workingHours={attendance.working_hours}
    />

    <CameraPreview webcamRef={webcamRef} />

    <div className="flex flex-wrap justify-center gap-4">

      <button
        onClick={captureImage}
        disabled={loading}
        className="px-5 py-3 rounded-lg bg-blue-600 text-white hover:bg-blue-700"
      >
        Capture Face
      </button>

      <button
        onClick={identifyAndCheckIn}
        disabled={
          loading ||
          !capturedBlob ||
          attendance.check_in !== null
        }
        className="px-5 py-3 rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
      >
        <LogIn className="inline w-4 h-4 mr-2" />
        Check In
      </button>

      <button
        onClick={identifyAndCheckOut}
        disabled={
            loading ||
            !capturedBlob ||
            attendance.check_in === null ||
            attendance.check_out !== null
        }
        className="px-5 py-3 rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
      >
        <LogOut className="inline w-4 h-4 mr-2" />
        Check Out
      </button>

    </div>

  </div>
);
}