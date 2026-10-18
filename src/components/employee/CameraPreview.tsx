'use client';

import Webcam from 'react-webcam';


import type { RefObject } from "react";

interface CameraPreviewProps {
  webcamRef: RefObject<Webcam>;
}

export default function CameraPreview({
  webcamRef,
}: CameraPreviewProps) {
  return (
    <div className="w-full rounded-xl overflow-hidden border bg-black">
      <Webcam
        ref={webcamRef}
        mirrored
        audio={false}
        screenshotFormat="image/jpeg"
        className="w-full h-[420px] object-cover"
        videoConstraints={{
          width: 1280,
          height: 720,
          facingMode: 'user',
        }}
      />
    </div>
  );
}