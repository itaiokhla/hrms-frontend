'use client';

import { useEffect, useRef, useState } from 'react';
import Webcam from 'react-webcam';
import api from '@/services/api';
import faceRecognitionService from "@/services/faceRecognition";
import StatusCards from "@/components/face-recognition/StatusCards";
import CameraCard from "@/components/face-recognition/CameraCard";
import CaptureCard from "@/components/face-recognition/CaptureCard";
import BackButton from "@/components/BackButton";

interface Employee {
  id: number;
  employee_id: string;
  first_name: string;
  last_name: string;
  email: string;
  position: string;
}

interface IdentifyResponse {
  identified: boolean;
  employee_id?: number;
  employee_name?: string;
  confidence?: number;
  email?: string;
  message?: string;
}

interface CheckInResponse {
  success: boolean;
  message: string;
  employee_id?: number;
  employee_name?: string;
  confidence?: number;
  check_in_time?: string;
}

export default function FaceRecognitionPage() {
  const webcamRef = useRef<Webcam>(null);

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [selectedEmployee, setSelectedEmployee] = useState('');
  const [lastScanTime, setLastScanTime] = useState(0);
 
  const speechRef = useRef<SpeechSynthesisUtterance | null>(null);
  

  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [autoMode, setAutoMode] = useState(false);
  const [processing, setProcessing] = useState(false);

  const [loading, setLoading] = useState(false);

  const [identifyResult, setIdentifyResult] =
    useState<IdentifyResponse | null>(null);

  const [checkInResult, setCheckInResult] =
    useState<CheckInResponse | null>(null);
  

  const [message, setMessage] = useState('');

  

  useEffect(() => {
    fetchEmployees();
  }, []);

  const fetchEmployees = async () => {
    try {
      const res = await api.get('/employees');
      setEmployees(res.data);
    } catch (err) {
      console.error(err);
    }
  };

  const capture = () => {
    if (!webcamRef.current) return;

    const image = webcamRef.current.getScreenshot();

    if (image) {
      setCapturedImage(image);
      setIdentifyResult(null);
      setCheckInResult(null);
      setMessage('');
    }
  };

  const dataURLtoFile = (
    dataurl: string,
    filename: string
  ): File => {

    const arr = dataurl.split(',');

    const mime = arr[0].match(/:(.*?);/)![1];

    const bstr = atob(arr[1]);

    let n = bstr.length;

    const u8arr = new Uint8Array(n);

    while (n--) {
      u8arr[n] = bstr.charCodeAt(n);
    }

    return new File([u8arr], filename, {
      type: mime,
    });
  };

  const registerFace = async () => {

    if (!capturedImage) {
      setMessage('Capture image first');
      return;
    }

    if (!selectedEmployee) {
      setMessage('Select employee');
      return;
    }

    try {

    setLoading(true);

    const file = dataURLtoFile(capturedImage, "face.jpg");

    console.log("Employee :", selectedEmployee);
    console.log("File :", file);

    const res = await faceRecognitionService.registerFace(
        Number(selectedEmployee),
        file
    );

    console.log("REGISTER RESPONSE");
    console.log(res);

    if (!res) {
        setMessage("Response is undefined");
        return;
    }

    setMessage(res.message || "Success");

} catch (err: any) {

    console.log(err);
    console.log(err.response);
    console.log(err.response?.data);

    setMessage(
        err.response?.data?.detail ||
        err.message ||
        "Registration Failed"
    );

} finally {

    setLoading(false);

}
  };

  

  
  
  useEffect(() => {

  if (!autoMode) return;

  if (!capturedImage) return;

  if (processing) return;

  const runRecognition = async () => {

    if (window.speechSynthesis.speaking) {
  console.log("Already speaking, skip this cycle");
  return;
}

  const now = Date.now();

  if (now - lastScanTime < 5000) return;

  setLastScanTime(now);

  try {

    setProcessing(true);

    const file = dataURLtoFile(capturedImage!, "face.jpg");

    const scanRes =
      await faceRecognitionService.scan(file);
    console.log("Scan completed");  
    
    console.log("1. Scan Response:", scanRes);
    console.log("Action:", scanRes.action);

if (!scanRes.success) {
  console.log("2. Scan failed");
  return;
}

console.log("3. Scan Success");

// if (scanRes.employee_id === lastEmployeeId) {
//   console.log("4. Same Employee");
//   return;
// }

console.log("5. Before Speech");  

    setMessage(scanRes.message);
    // alert("Message Set");

    

    // if (scanRes.employee_id === lastEmployeeId) return;

    // setLastEmployeeId(scanRes.employee_id!);

    window.speechSynthesis.cancel();

    

    let speechText = "";
    

if (scanRes.action === "check_in") {
  speechText = `Welcome ${scanRes.employee_name}. Your check in has been recorded successfully. Have a great day.`;
} else if (scanRes.action === "check_out") {
  speechText = `Goodbye ${scanRes.employee_name}. Your check out has been recorded successfully. Have a nice day.`;
} else if (scanRes.action === "wait") {
  speechText = scanRes.message; // "Please wait X seconds..."
} else {
  speechText = `Hello ${scanRes.employee_name}. Your attendance has already been completed for today.`;
}



console.log("Speech Text:", speechText);
// alert("Speech Start");

const speech = new SpeechSynthesisUtterance(speechText);
speechRef.current = speech;   

speech.lang = "en-US";
speech.rate = 1;
speech.pitch = 1;
speech.volume = 1;

speech.onstart = () => console.log("Speech Started");
speech.onend = () => console.log("Speech Ended");
speech.onerror = (e) => console.log("Speech Error", e);

window.speechSynthesis.cancel();

setTimeout(() => {

  console.log("Calling speak()");

  window.speechSynthesis.speak(speech);

}, 300);



  } catch (err: any) {

    console.log(err);
    console.log(err.response?.data);

  } finally {

    setProcessing(false);

  }

};

  runRecognition();

}, [capturedImage, autoMode]);



  return (
  <div className="min-h-screen bg-slate-50 p-6">

    <BackButton />

    <div className="mb-8 rounded-3xl bg-gradient-to-r from-blue-600 to-indigo-700 p-8 text-white shadow-xl">

      <h1 className="text-4xl font-bold">
        Face Recognition
      </h1>



      <p className="mt-2 text-blue-100">
        Register • Identify • Attendance
      </p>

    </div>

<div className="grid gap-8 lg:grid-cols-2">


<StatusCards
  cameraConnected={true}
  employeeSelected={selectedEmployee !== ""}
  faceCaptured={capturedImage !== null}
  aiReady={true}
/>  
<div className="mb-4">

  <button
    onClick={() => setAutoMode(!autoMode)}
    className={`w-full rounded-xl py-3 font-semibold text-white transition ${
      autoMode
        ? "bg-red-600 hover:bg-red-700"
        : "bg-green-600 hover:bg-green-700"
    }`}
  >
    {autoMode
      ? "🛑 Stop Live Recognition"
      : "▶ Start Live Recognition"}
  </button>

</div>
<CameraCard
    webcamRef={webcamRef}
    onCapture={capture}
    autoCapture={autoMode}
/>

{autoMode && (
  <div className="mt-4 rounded-xl bg-green-100 p-4 text-center font-semibold text-green-700 animate-pulse">
    🟢 Live Face Recognition Running...
  </div>
)}


<CaptureCard
  capturedImage={capturedImage}
  employees={employees}
  selectedEmployee={selectedEmployee}
  setSelectedEmployee={setSelectedEmployee}
  loading={loading}
  message={message}
  onRegister={registerFace}
  
  
/>

          {identifyResult?.identified && (

            <div className="mt-6 rounded-2xl border border-green-300 bg-green-50 p-5">

              <h3 className="mb-4 text-xl font-bold text-green-700">
                Face Identified
              </h3>

              <div className="space-y-2">

                <p>
                  <span className="font-semibold">
                    Employee :
                  </span>{' '}
                  {identifyResult.employee_name}
                </p>

                <p>
                  <span className="font-semibold">
                    Employee ID :
                  </span>{' '}
                  {identifyResult.employee_id}
                </p>

                <p>
                  <span className="font-semibold">
                    Email :
                  </span>{' '}
                  {identifyResult.email}
                </p>

                <p>
                  <span className="font-semibold">
                    Confidence :
                  </span>{' '}
                  {(identifyResult.confidence! * 100).toFixed(2)}%
                </p>

              </div>

            </div>

          )}

          {identifyResult &&
            !identifyResult.identified && (

            <div className="mt-6 rounded-2xl border border-red-300 bg-red-50 p-5">

              <h3 className="text-xl font-bold text-red-700">
                Face Not Recognized
              </h3>

            </div>

          )}

          {checkInResult?.success && (

            <div className="mt-6 rounded-2xl border border-green-300 bg-green-50 p-5">

              <h3 className="mb-3 text-xl font-bold text-green-700">
                Attendance Marked Successfully
              </h3>

              <p>
                <span className="font-semibold">
                  Employee :
                </span>{' '}
                {checkInResult.employee_name}
              </p>

              <p>
                <span className="font-semibold">
                  Confidence :
                </span>{' '}
                {(checkInResult.confidence! * 100).toFixed(2)}%
              </p>

              <p>
                <span className="font-semibold">
                  Check In Time :
                </span>{' '}
                {new Date(
                  checkInResult.check_in_time!
                ).toLocaleTimeString()}
              </p>

            </div>

          )}

        </div>

      </div>

    

  );
}
