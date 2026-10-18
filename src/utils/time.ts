export function formatDuration(seconds: number): string {
  if (seconds <= 0) return "00:00:00";

  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  return [
    hrs.toString().padStart(2, "0"),
    mins.toString().padStart(2, "0"),
    secs.toString().padStart(2, "0"),
  ].join(":");
}

export function getWorkingSeconds(checkIn: string | Date) {
  const start = new Date(checkIn).getTime();
  const now = Date.now();

  return Math.floor((now - start) / 1000);
}