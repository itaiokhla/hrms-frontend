"use client";

import { useEffect, useState } from "react";

export default function LiveClock() {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => {
      setTime(new Date());
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  return (
    <div className="text-right">
      <h2 className="text-xl font-bold">
        {time.toLocaleTimeString()}
      </h2>

      <p className="text-gray-500">
        {time.toDateString()}
      </p>
    </div>
  );
}