'use client';

interface Employee {
  id: number;
  first_name: string;
  last_name: string;
}

interface CaptureCardProps {
  capturedImage: string | null;
  employees: Employee[];
  selectedEmployee: string;
  setSelectedEmployee: (value: string) => void;
  loading: boolean;
  message: string;
  onRegister: () => void;
  
}

export default function CaptureCard({
  capturedImage,
  employees,
  selectedEmployee,
  setSelectedEmployee,
  loading,
  message,
  onRegister,
  
}: CaptureCardProps) {
  return (
    <div className="rounded-3xl bg-white p-6 shadow-lg">

      <h2 className="mb-5 text-2xl font-bold">
        Captured Image
      </h2>

      {capturedImage ? (
        <img
          src={capturedImage}
          alt="Captured"
          className="h-72 w-full rounded-2xl border object-cover"
        />
      ) : (
        <div className="flex h-72 items-center justify-center rounded-2xl border-2 border-dashed border-gray-300 text-gray-400">
          No Image Captured
        </div>
      )}

      <div className="mt-6">
        <label className="mb-2 block text-sm font-semibold">
          Select Employee
        </label>

        <select
          value={selectedEmployee}
          onChange={(e) => setSelectedEmployee(e.target.value)}
          className="w-full rounded-xl border p-3"
        >
          <option value="">Choose Employee</option>

          {employees.map((emp) => (
            <option key={emp.id} value={emp.id}>
              {emp.first_name} {emp.last_name}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-6">

        <button
          onClick={onRegister}
          disabled={loading}
          className="w-full rounded-xl bg-green-600 py-3 font-semibold text-white hover:bg-green-700"
        >
          Register Face
        </button>

        

      </div>

      {loading && (
        <div className="mt-6 rounded-xl bg-yellow-100 p-4 text-center text-yellow-700">
          Processing...
        </div>
      )}

      {message && (
        <div
          className={`mt-6 rounded-xl p-4 text-center font-semibold ${
            message.toLowerCase().includes("success")
              ? "bg-green-100 text-green-700"
              : message.toLowerCase().includes("failed")
              ? "bg-red-100 text-red-700"
              : "bg-blue-100 text-blue-700"
          }`}
        >
          {message}
        </div>
      )}

    </div>
  );
}