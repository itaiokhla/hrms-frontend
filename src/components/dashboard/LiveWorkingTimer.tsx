"use client";

import { useEffect, useState } from "react";
import { Clock } from "lucide-react";
import { formatDuration, getWorkingSeconds } from "@/utils/time";

interface Props {
  checkIn: string;
}

export default function LiveWorkingTimer({ checkIn }: Props) {
  const [seconds, setSeconds] = useState(
    getWorkingSeconds(checkIn)
  );

  useEffect(() => {
    const interval = setInterval(() => {
      setSeconds(getWorkingSeconds(checkIn));
    }, 1000);

    return () => clearInterval(interval);
  }, [checkIn]);

  return (
    <div className="flex items-center gap-2">
      <Clock className="w-4 h-4 text-green-600" />

      <span className="font-bold text-green-700 text-lg">
        {formatDuration(seconds)}
      </span>
    </div>
  );
}