'use client';

import { useEffect, useState } from "react";
import BackButton from "@/components/BackButton";
import PageLoader from "@/components/PageLoader";
import employeeLeaveService from "@/services/employeeLeaveService";
import type {
  Leave,
  LeaveBalance,
  ApplyLeaveRequest,
} from "@/types/leave";
import { Plus, Calendar } from "lucide-react";
import { toast } from "react-hot-toast";


export default function EmployeeLeavesPage() {

  const [loading, setLoading] = useState(true);

  const [showModal, setShowModal] = useState(false);

  const [leaves, setLeaves] = useState<Leave[]>([]);

  const [balance, setBalance] =
    useState<LeaveBalance | null>(null);

  const [form, setForm] =
    useState<ApplyLeaveRequest>({
      leave_type: "",
      start_date: "",
      end_date: "",
      reason: "",
    });

  const totalLeaves = leaves.length;

  const approvedLeaves = leaves.filter(
  (leave) => leave.status.toLowerCase() === "approved"
).length;

const pendingLeaves = leaves.filter(
  (leave) => leave.status.toLowerCase() === "pending"
).length;


  
  const loadData = async () => {
    try {

      setLoading(true);

      const [leaveData, leaveBalance] =
        await Promise.all([
          employeeLeaveService.getMyLeaves(),
          employeeLeaveService.getLeaveBalance(),
        ]);

      setLeaves(leaveData);

      setBalance(leaveBalance);
      console.log("Leave Balance =", leaveBalance);

    } catch (error) {

      console.error(error);

      toast.error("Unable to load leaves.");

    } finally {

      setLoading(false);

    }
  };
  useEffect(() => {
    loadData();
  }, []);

  const handleSubmit = async () => {
    if (
      !form.leave_type ||
      !form.start_date ||
      !form.end_date ||
      !form.reason.trim()
    ) {
      toast.error("Please fill all fields.");
      return;
    }

    if (new Date(form.end_date) < new Date(form.start_date)) {
      toast.error("End date cannot be before start date.");
      return;
    }

    try {
      await employeeLeaveService.applyLeave(form);

      toast.success("Leave applied successfully.");

      setShowModal(false);

      setForm({
        leave_type: "",
        start_date: "",
        end_date: "",
        reason: "",
      });

      loadData();

    } catch (error) {

      console.error(error);

      toast.error("Failed to apply leave.");
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "Approved":
        return "bg-green-100 text-green-700";

      case "Rejected":
        return "bg-red-100 text-red-700";

      default:
        return "bg-yellow-100 text-yellow-700";
    }
  };

  const handleCancelLeave = async (id: number) => {
    if (!confirm("Are you sure you want to cancel this leave?")) {
      return;
    }

    try {
      await employeeLeaveService.cancelLeave(id);

      toast.success("Leave cancelled successfully.");

      loadData();

    } catch (error) {

      console.error(error);

      toast.error("Unable to cancel leave.");
    }
  };


  return (
    <>
    <div className="min-h-screen bg-slate-50 p-6">

      <BackButton />

      <div className="mb-8 flex items-center justify-between rounded-3xl bg-gradient-to-r from-blue-600 to-indigo-700 p-8 text-white shadow-xl">

        <div>
          <h1 className="text-4xl font-bold">
            My Leaves
          </h1>

          <p className="mt-2 text-blue-100">
            Apply leave and track your requests
          </p>
        </div>

        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-2 rounded-xl bg-white px-5 py-3 font-semibold text-blue-700 transition hover:bg-blue-50"
        >
          <Plus size={20} />
          Apply Leave
        </button>

      </div>

      {/* Stats */}

      <div className="grid gap-6 md:grid-cols-3">

        <div className="rounded-2xl bg-white p-6 shadow">

          <p className="text-gray-500">
            Total Leaves
          </p>

          <h2 className="mt-2 text-4xl font-bold text-blue-600">
            {totalLeaves}
          </h2>

        </div>

        <div className="rounded-2xl bg-white p-6 shadow">

          <p className="text-gray-500">
            Approved
          </p>

          <h2 className="mt-2 text-4xl font-bold text-green-600">
            {approvedLeaves}
          </h2>

        </div>

        <div className="rounded-2xl bg-white p-6 shadow">

          <p className="text-gray-500">
            Pending
          </p>

          <h2 className="mt-2 text-4xl font-bold text-yellow-500">
            {pendingLeaves}
          </h2>

        </div>

      </div>

      <div className="mt-8 grid gap-6 md:grid-cols-3">

        <div className="rounded-2xl bg-white p-6 shadow">

          <h3 className="font-semibold">
            Earned Leave
          </h3>

          <p className="mt-3 text-3xl font-bold text-blue-600">
            {balance?.earned?.remaining ?? 0}
          </p>

          <p className="mt-2 text-sm text-gray-500">
            Used {balance?.earned?.used ?? 0} / {balance?.earned?.total ?? 0}
          </p>

        </div>

        <div className="rounded-2xl bg-white p-6 shadow">

          <h3 className="font-semibold">
            Sick Leave
          </h3>

          <p className="mt-3 text-3xl font-bold text-green-600">
            {balance?.sick?.remaining ?? 0}
          </p>

          <p className="mt-2 text-sm text-gray-500">
            Used {balance?.sick?.used ?? 0} / {balance?.sick?.total ?? 0}
          </p>
        </div>

        <div className="rounded-2xl bg-white p-6 shadow">

          <h3 className="font-semibold">
            Casual Leave
          </h3>

          <p className="mt-3 text-3xl font-bold text-orange-500">
            {balance?.casual?.remaining ?? 0}
          </p>

          <p className="mt-2 text-sm text-gray-500">
            Used {balance?.casual?.used ?? 0} / {balance?.casual?.total ?? 0}
          </p>

        </div>
      </div>
      <div className="mt-10 rounded-3xl bg-white p-6 shadow">

        <div className="mb-6 flex items-center justify-between">

          <h2 className="text-2xl font-bold">
            Leave History
          </h2>

          <span className="text-gray-500">
            {leaves.length} Records
          </span>

        </div>

        {loading ? (

          
             <PageLoader />
         

        ) : leaves.length === 0 ? (

          <div className="py-16 text-center">

            <Calendar
              size={50}
              className="mx-auto mb-4 text-gray-300"
            />

            <h3 className="text-xl font-semibold">
              No Leave Records
            </h3>

            <p className="mt-2 text-gray-500">
              Apply your first leave.
            </p>

          </div>

        ) : (

          <div className="overflow-x-auto">

            <table className="w-full">

              <thead>

                <tr className="border-b">

                  <th className="py-3 text-left">
                    Leave Type
                  </th>

                  <th className="py-3 text-left">
                    Start
                  </th>

                  <th className="py-3 text-left">
                    End
                  </th>

                  <th className="py-3 text-left">
                    Status
                  </th>

                  <th className="py-3 text-left">
                    Reason
                  </th>

                  <th className="py-3 text-center">
                    Action
                  </th>

                </tr>

              </thead>

              <tbody>

                {leaves.map((leave) => (

                  <tr
                    key={leave.id}
                    className="border-b hover:bg-gray-50"
                  >

                    <td className="py-4">
                      {leave.leave_type}
                    </td>

                    <td>
                      {leave.start_date}
                    </td>

                    <td>
                      {leave.end_date}
                    </td>

                    <td>

                      <span
                        className={`rounded-full px-3 py-1 text-sm font-medium ${getStatusColor(
                          leave.status
                        )}`}
                      >
                        {leave.status}
                      </span>

                    </td>

                    <td className="max-w-xs truncate">
                      {leave.reason}
                    </td>

                    <td className="text-center">

                      {leave.status.toLowerCase() === "pending" && (

                        <button
                          onClick={() =>
                            handleCancelLeave(
                              leave.id
                            )
                          }
                          className="rounded-lg bg-red-500 px-4 py-2 text-sm text-white hover:bg-red-600"
                        >
                          Cancel
                        </button>

                      )}

                    </td>

                  </tr>

                ))}

              </tbody>

            </table>

          </div>

        )}

      </div>

    </div>

      {
    showModal && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">

        <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">

          <div className="mb-6 flex items-center gap-3">

            <div className="rounded-xl bg-blue-100 p-3">
              <Calendar className="text-blue-600" size={22} />
            </div>

            <div>
              <h2 className="text-2xl font-bold">
                Apply Leave
              </h2>

              <p className="text-gray-500 text-sm">
                Fill the form below
              </p>
            </div>

          </div>

          <div className="mb-4">

            <label className="mb-2 block font-medium">
              Leave Type
            </label>

            <select
              className="w-full rounded-xl border p-3 outline-none focus:border-blue-500"
              value={form.leave_type}
              onChange={(e) =>
                setForm({
                  ...form,
                  leave_type: e.target.value,
                })
              }
            >
              <option value="">Select Leave</option>

              <option value="earned">Earned Leave</option>
              <option value="sick">Sick Leave</option>
              <option value="casual">Casual Leave</option>
              <option value="unpaid">Unpaid Leave</option>
              <option value="maternity">Maternity Leave</option>
              <option value="paternity">Paternity Leave</option>
            </select>

          </div>

          <div className="grid gap-4 md:grid-cols-2">

            <div>

              <label className="mb-2 block font-medium">
                Start Date
              </label>

              <input
                type="date"
                className="w-full rounded-xl border p-3"
                value={form.start_date}
                onChange={(e) =>
                  setForm({
                    ...form,
                    start_date: e.target.value,
                  })
                }
              />

            </div>

            <div>

              <label className="mb-2 block font-medium">
                End Date
              </label>

              <input
                type="date"
                className="w-full rounded-xl border p-3"
                value={form.end_date}
                onChange={(e) =>
                  setForm({
                    ...form,
                    end_date: e.target.value,
                  })
                }
              />

            </div>

          </div>

          <div className="mt-4">

            <label className="mb-2 block font-medium">
              Reason
            </label>

            <textarea
              rows={4}
              className="w-full rounded-xl border p-3"
              placeholder="Write your reason..."
              value={form.reason}
              onChange={(e) =>
                setForm({
                  ...form,
                  reason: e.target.value,
                })
              }
            />

          </div>
          <div className="mt-6 flex justify-end gap-3">

            <button
              onClick={() => setShowModal(false)}
              className="rounded-xl border px-5 py-3 font-medium hover:bg-gray-100"
            >
              Cancel
            </button>

            <button
              onClick={handleSubmit}
              className="rounded-xl bg-blue-600 px-5 py-3 font-medium text-white hover:bg-blue-700"
            >
              Apply Leave
            </button>

          </div>

        </div>   {/* Modal Box */}

      </div>       

      
  

     )}

  </>
); }
