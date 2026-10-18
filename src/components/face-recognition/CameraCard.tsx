'use client';

import Webcam from 'react-webcam';
import { MutableRefObject, useEffect } from "react";

interface CameraCardProps {
  webcamRef: MutableRefObject<Webcam | null>;
  onCapture: () => void;
  autoCapture?: boolean;
}
export default function CameraCard({
  webcamRef,
  onCapture,
  autoCapture = false,
}: CameraCardProps) {
  const videoConstraints = {
    width: 640,
    height: 480,
    facingMode: 'user',
  };
  useEffect(() => {

  if (!autoCapture) return;

  const interval = setInterval(() => {
    onCapture();
  }, 3000);

  return () => clearInterval(interval);

}, [autoCapture, onCapture]);

  return (
    <div className="rounded-3xl bg-white p-6 shadow-lg">

      <div className="mb-4 flex items-center justify-between">

        <h2 className="text-2xl font-bold">
          📷 Live Camera
        </h2>

        <span className="rounded-full bg-green-100 px-4 py-2 text-sm font-semibold text-green-700">
          🟢 Connected
        </span>

      </div>

      <Webcam
        audio={false}
        ref={webcamRef}
        screenshotFormat="image/jpeg"
        videoConstraints={videoConstraints}
        className="w-full rounded-2xl border"
      />

      <button
        onClick={onCapture}
        className="mt-6 w-full rounded-xl bg-blue-600 py-3 font-semibold text-white transition hover:bg-blue-700"
      >
        📸 Capture Image
      </button>

    </div>
  );
}