'use client';

import { useState, useRef, useEffect } from 'react';
import api from '@/services/api';
import { Camera, Upload, AlertCircle, CheckCircle } from 'lucide-react';
import BackButton from "@/components/BackButton";


type AttendanceStatus = 'idle' | 'processing' | 'success' | 'error';

interface AttendanceResult {
  success: boolean;
  message: string;
  employee_id?: number;
  employee_name?: string;
  confidence?: number;
  check_in_time?: string;
}

export default function AttendancePage() {
  const [status, setStatus] = useState<AttendanceStatus>('idle');
  const [result, setResult] = useState<AttendanceResult | null>(null);
  const [webcamActive, setWebcamActive] = useState(false);
  const [uploadedImage, setUploadedImage] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (webcamActive) {
      startWebcam();
    } else {
      stopWebcam();
    }

    return () => stopWebcam();
  }, [webcamActive]);

  const startWebcam = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480 },
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (error) {
      console.error('Error accessing webcam:', error);
      setWebcamActive(false);
      setStatus('error');
      setResult({ success: false, message: 'Unable to access webcam' });
    }
  };

  const stopWebcam = () => {
    if (videoRef.current?.srcObject) {
      (videoRef.current.srcObject as MediaStream).getTracks().forEach((track) => track.stop());
    }
  };

  const captureAndCheckIn = async () => {
    if (!videoRef.current || !canvasRef.current) return;

    const context = canvasRef.current.getContext('2d');
    if (!context) return;

    context.drawImage(videoRef.current, 0, 0, 640, 480);

    setStatus('processing');

    try {
      canvasRef.current.toBlob(async (blob) => {
        if (!blob) return;

        const formData = new FormData();
        formData.append('file', blob, 'checkin.jpg');

        const response = await api.post('/face-recognition/check-in-face', formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });

        const data: AttendanceResult = response.data;
        setResult(data);
        setStatus(data.success ? 'success' : 'error');

        if (data.success) {
          setWebcamActive(false);
        }
      }, 'image/jpeg');
    } catch (error) {
      console.error('Error during check-in:', error);
      setStatus('error');
      setResult({
        success: false,
        message: 'Check-in failed. Please try again.',
      });
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      setUploadedImage(event.target?.result as string);
      setStatus('processing');

      try {
        const formData = new FormData();
        formData.append('file', file);

        const response = await api.post('/face-recognition/check-in-face', formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });

        const data: AttendanceResult = response.data;
        setResult(data);
        setStatus(data.success ? 'success' : 'error');
      } catch (error) {
        console.error('Error during check-in:', error);
        setStatus('error');
        setResult({
          success: false,
          message: 'Check-in failed. Please try again.',
        });
      }
    };
    reader.readAsDataURL(file);
  };

  const reset = () => {
    setStatus('idle');
    setResult(null);
    setUploadedImage(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
  <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-100 p-8 space-y-8">

    <BackButton />

    <div className="mb-8">
      <h1 className="text-5xl font-extrabold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
        Smart Attendance
      </h1>

      <p className="mt-3 text-lg text-gray-600">
        AI Facial Recognition Attendance System
      </p>
    </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
  <div className="bg-white rounded-2xl shadow-xl p-6">
    <h3 className="text-gray-500 text-sm">Recognition Accuracy</h3>
    <p className="text-4xl font-bold text-green-600">99.2%</p>
  </div>

  <div className="bg-white rounded-2xl shadow-xl p-6">
    <h3 className="text-gray-500 text-sm">Today's Check-ins</h3>
    <p className="text-4xl font-bold text-blue-600">142</p>
  </div>

  <div className="bg-white rounded-2xl shadow-xl p-6">
    <h3 className="text-gray-500 text-sm">System Status</h3>
    <p className="text-4xl font-bold text-purple-600">Online</p>
  </div>
</div>
<div className="grid grid-cols-1 lg:grid-cols-2 gap-8">

        {/* Webcam Section */}
        <div className="bg-white/90 backdrop-blur-xl rounded-3xl shadow-2xl p-6 border border-white/20">
          <h2 className="text-xl font-bold text-gray-900 mb-4 flex items-center">
            <Camera className="mr-2" />
            Webcam Check-in
          </h2>

          {!webcamActive ? (
            <div className="bg-gradient-to-br from-blue-50 to-indigo-100 rounded-3xl p-8 flex flex-col items-center justify-center h-80 border-2 border-dashed border-blue-300">
              <Camera size={48} className="text-gray-400 mb-4" />
              <p className="text-gray-600 text-center mb-4">
                Position your face in the camera frame
              </p>
              <button
                onClick={() => setWebcamActive(true)}
                className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-semibold py-3 px-8 rounded-xl shadow-lg transition-all duration-300"
              >
                Start Webcam
              </button>
            </div>
          ) : (
            <>
              <video
                ref={videoRef}
                autoPlay
                playsInline
                className="w-full h-80 bg-black rounded-3xl mb-4 shadow-xl"
              />
              <canvas ref={canvasRef} className="hidden" width={640} height={480} />

              <div className="flex gap-4">
                <button
                  onClick={captureAndCheckIn}
                  disabled={status === 'processing'}
                  className="flex-1 bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white font-semibold py-2 px-4 rounded-lg transition"
                >
                  {status === 'processing' ? 'Processing...' : 'Check-in'}
                </button>
                <button
                  onClick={() => setWebcamActive(false)}
                  className="flex-1 bg-red-600 hover:bg-red-700 text-white font-semibold py-2 px-4 rounded-lg transition"
                >
                  Stop
                </button>
              </div>
            </>
          )}
        </div>

        {/* Upload Section */}
        <div className="bg-white/90 backdrop-blur-xl rounded-3xl shadow-2xl p-6 border border-white/20">
          <h2 className="text-xl font-bold text-gray-900 mb-4 flex items-center">
            <Upload className="mr-2" />
            Upload Photo
          </h2>

          <div
            onClick={() => fileInputRef.current?.click()}
            className="bg-gradient-to-br from-purple-50 to-pink-50 rounded-3xl p-8 flex flex-col items-center justify-center h-80 cursor-pointer transition border-2 border-dashed border-purple-300 hover:scale-[1.02] hover:shadow-xl"
          >
            <Upload size={48} className="text-gray-400 mb-4" />
            <p className="text-gray-600 text-center mb-2">
              Click to upload a photo
            </p>
            <p className="text-gray-500 text-sm">
              JPG, JPEG, or PNG
            </p>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleImageUpload}
            className="hidden"
          />

          {uploadedImage && (
            <div className="mt-4">
              <img
                src={uploadedImage}
                alt="Uploaded preview"
                className="w-full h-48 object-cover rounded-lg"
              />
            </div>
          )}
        </div>
      </div>

      {/* Results */}
      {result && (
        <div className={`rounded-3xl p-6 shadow-2xl ${result.success ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
          <div className="flex items-start">
            {result.success ? (
              <CheckCircle size={24} className="text-green-600 mr-4 flex-shrink-0 mt-1" />
            ) : (
              <AlertCircle size={24} className="text-red-600 mr-4 flex-shrink-0 mt-1" />
            )}
            <div className="flex-1">
              <h3 className={`font-bold ${result.success ? 'text-green-900' : 'text-red-900'}`}>
                {result.success ? 'Check-in Successful!' : 'Check-in Failed'}
              </h3>
              <p className={`text-sm mt-1 ${result.success ? 'text-green-700' : 'text-red-700'}`}>
                {result.message}
              </p>
              {result.success && result.employee_name && (
                <div className="mt-3 text-sm text-gray-700 space-y-1">
                  <p><strong>Name:</strong> {result.employee_name}</p>
                  <p><strong>Time:</strong> {new Date(result.check_in_time!).toLocaleTimeString()}</p>
                  <p><strong>Confidence:</strong> {(result.confidence! * 100).toFixed(1)}%</p>
                </div>
              )}
            </div>
            <button
              onClick={reset}
              className="text-gray-500 hover:text-gray-700 flex-shrink-0"
            >
              ✕
            </button>
          </div>
          {result.success && (
            <button
              onClick={reset}
              className="mt-4 w-full bg-green-600 hover:bg-green-700 text-white font-semibold py-2 px-4 rounded-lg transition"
            >
              Done
            </button>
          )}
        </div>
      )}
    </div>
  );
}
