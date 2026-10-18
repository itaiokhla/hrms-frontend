'use client';

import { useEffect, useState } from 'react';
import { Wallet, FileText, Calendar } from 'lucide-react';
import  payrollService  from '@/services/payrollService';
import type { Payroll } from "@/types/payroll";
import { toast } from 'react-toastify';
import BackButton from "@/components/BackButton";



export default function EmployeeSalaryPage() {
  const [payrolls, setPayrolls] = useState<Payroll[]>([]);
  const [loading, setLoading] = useState(true);
  const [salarySlip, setSalarySlip] = useState<any>(null);
const [showSlip, setShowSlip] = useState(false);

  const loadPayrolls = async () => {
    try {
      const data = await payrollService.getMyPayroll();
      setPayrolls(data);
    } catch (err) {
      toast.error('Unable to load salary records');
    } finally {
      setLoading(false);
    }
  };

  const viewSalarySlip = async (payrollId: number) => {
  try {
    const data = await payrollService.getSalarySlip(payrollId);

    setSalarySlip(data);
    setShowSlip(true);
  } catch (err) {
    toast.error("Unable to load salary slip");
  }
};

  useEffect(() => {
    loadPayrolls();
  }, []);

  if (loading) {
    return (
      <div className="flex justify-center items-center h-[70vh]">
        Loading Salary...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <BackButton />

        <div>
          <h1 className="text-3xl font-bold">
            Dashboard
          </h1>
          <p className="text-gray-500">
            Welcome back
          </p>
        </div>

      <div>
        <h1 className="text-3xl font-bold">
          My Salary
        </h1>

        <p className="text-gray-500">
          View salary history and salary slips.
        </p>
      </div>

      {payrolls.length === 0 ? (
        <div className="bg-white rounded-xl shadow p-10 text-center">
          <Wallet className="mx-auto h-12 w-12 text-gray-400 mb-4" />

          <h2 className="text-xl font-semibold">
            No Salary Records
          </h2>

          <p className="text-gray-500 mt-2">
            Salary has not been generated yet.
          </p>
        </div>
      ) : (
        <div className="grid gap-5">

          {payrolls.map((salary) => (

            <div
              key={salary.id}
              className="bg-white rounded-xl shadow p-6 flex justify-between items-center"
            >
              <div>

                <div className="flex items-center gap-2 font-semibold text-lg">
                  <Calendar size={18} />
                  {salary.salary_month}
                </div>

                <p className="text-gray-500 mt-2">
                  Gross Salary :
                  <span className="font-semibold text-black ml-2">
                    ₹{salary.gross_salary.toLocaleString()}
                  </span>
                </p>

                <p className="text-gray-500">
                  Net Salary :
                  <span className="font-bold text-green-600 ml-2">
                    ₹{salary.net_salary.toLocaleString()}
                  </span>
                </p>

                <span
                  className={`inline-block mt-3 px-3 py-1 rounded-full text-sm ${
                    salary.status === 'processed'
                      ? 'bg-green-100 text-green-700'
                      : salary.status === 'approved'
                      ? 'bg-blue-100 text-blue-700'
                      : 'bg-yellow-100 text-yellow-700'
                  }`}
                >
                  {salary.status}
                </span>

              </div>

              <button
                onClick={() => viewSalarySlip(salary.id)}
                className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-5 py-3 rounded-lg"
              >
                <FileText size={18} />
                Salary Slip
              </button>

            </div>

          ))}

        </div>
      )}
      {showSlip && salarySlip && (
  <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
    <div className="bg-white rounded-xl p-6 w-[700px] max-h-[90vh] overflow-y-auto">

      <h2 className="text-2xl font-bold mb-6">
        Salary Slip
      </h2>

      <p><b>Employee:</b> {salarySlip.employee.name}</p>
      <p><b>Employee ID:</b> {salarySlip.employee.employee_id}</p>
      <p><b>Department:</b> {salarySlip.employee.department}</p>
      <p><b>Designation:</b> {salarySlip.employee.designation}</p>

      <hr className="my-5" />

      <p>Basic Salary : ₹{salarySlip.salary_components.basic_salary}</p>
      <p>HRA : ₹{salarySlip.salary_components.house_rent_allowance}</p>
      <p>DA : ₹{salarySlip.salary_components.dearness_allowance}</p>
      <p>Conveyance : ₹{salarySlip.salary_components.conveyance_allowance}</p>

      <hr className="my-5" />

      <p>Total Deductions : ₹{salarySlip.total_deductions}</p>

      <h3 className="text-2xl font-bold text-green-600 mt-5">
        Net Salary : ₹{salarySlip.net_salary}
      </h3>

      <button
        onClick={() => setShowSlip(false)}
        className="mt-6 w-full bg-red-600 text-white py-3 rounded-lg"
      >
        Close
      </button>

    </div>
  </div>
)}

    </div>
  );
}