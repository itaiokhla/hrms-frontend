'use client';

import { useEffect, useState } from "react";
import api from "@/services/api";
import BackButton from "@/components/BackButton";
import PageLoader from "@/components/PageLoader";
import LeaveStats from "@/components/leaves/LeaveStats";
import { Check, X } from "lucide-react";

interface Leave {
  id: number;
  employee_id: number;
  employee_name: string;
  leave_type: string;
  start_date: string;
  end_date: string;
  number_of_days: number;
  reason?: string;
  status: "pending" | "approved" | "rejected";
  created_at: string;
}

export default function LeavesPage() {

  const [loading, setLoading] = useState(false);

  const [activeTab, setActiveTab] = useState<"pending" | "all">("pending");

  const [pendingLeaves, setPendingLeaves] = useState<Leave[]>([]);

  const [allLeaves, setAllLeaves] = useState<Leave[]>([]);

  const [leaveStats, setLeaveStats] = useState({
    total: 0,
    pending: 0,
    approved: 0,
    rejected: 0,
  });

  useEffect(() => {
    fetchData();
  }, [activeTab]);

  const fetchData = async () => {
    try {
      setLoading(true);

      // Stats + All Leaves
      const allResponse = await api.get("/leaves");
      const allData: Leave[] = allResponse.data;

      setLeaveStats({
        total: allData.length,
        pending: allData.filter(l => l.status === "pending").length,
        approved: allData.filter(l => l.status === "approved").length,
        rejected: allData.filter(l => l.status === "rejected").length,
      });

      setAllLeaves(allData);

      // Pending Leaves
      const pendingResponse = await api.get("/leaves/pending");
      setPendingLeaves(pendingResponse.data);

    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const approveLeave = async (id: number) => {
    try {
      await api.post(`/leaves/${id}/approve`);
      alert("Leave Approved Successfully");
      fetchData();
    } catch {
      alert("Failed to approve leave");
    }
  };

  const rejectLeave = async (id: number) => {
    try {
      await api.post(`/leaves/${id}/reject`);
      alert("Leave Rejected Successfully");
      fetchData();
    } catch {
      alert("Failed to reject leave");
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "approved":
        return "bg-green-100 text-green-700";

      case "pending":
        return "bg-yellow-100 text-yellow-700";

      case "rejected":
        return "bg-red-100 text-red-700";

      default:
        return "bg-gray-100 text-gray-700";
    }
  };

  return (
    <div className="space-y-6">

  <BackButton />

  {/* Header */}
  <div className="flex items-center justify-between">

    <div>
      <h1 className="text-4xl font-bold text-gray-900">
        Leave Management
      </h1>

      <p className="text-gray-600 mt-2">
        Manage employee leave requests
      </p>
    </div>

  </div>

  {/* Stats */}
  <LeaveStats
    stats={leaveStats}
  />

  {/* Tabs */}
  <div className="bg-white rounded-2xl shadow-lg overflow-hidden">

    <div className="flex border-b">

      <button
        onClick={() => setActiveTab("pending")}
        className={`flex-1 py-4 font-semibold transition ${
          activeTab === "pending"
            ? "bg-blue-600 text-white"
            : "bg-white text-gray-600 hover:bg-gray-50"
        }`}
      >
        Pending Approvals
      </button>

      <button
        onClick={() => setActiveTab("all")}
        className={`flex-1 py-4 font-semibold transition ${
          activeTab === "all"
            ? "bg-blue-600 text-white"
            : "bg-white text-gray-600 hover:bg-gray-50"
        }`}
      >
        All Leaves
      </button>

    </div>

    <div className="p-6">
      {/* Pending Approvals */}
{activeTab === "pending" && (
  <>
    {loading ? (
     
        <PageLoader />
      
    ) : pendingLeaves.length === 0 ? (
      <div className="text-center py-8 text-gray-500">
        No Pending Leave Requests
      </div>
    ) : (
      <div className="overflow-x-auto">
        <table className="min-w-full border border-gray-200 rounded-lg">
          <thead className="bg-gray-100">
            <tr>
              <th className="px-4 py-3 text-left">Employee</th>
              <th className="px-4 py-3 text-left">Leave Type</th>
              <th className="px-4 py-3 text-left">Start</th>
              <th className="px-4 py-3 text-left">End</th>
              <th className="px-4 py-3 text-center">Days</th>
              <th className="px-4 py-3 text-left">Reason</th>
              <th className="px-4 py-3 text-left">Applied On</th>
              <th className="px-4 py-3 text-center">Action</th>
            </tr>
          </thead>

          <tbody>
            {pendingLeaves.map((leave) => (
              <tr
                key={leave.id}
                className="border-t hover:bg-gray-50 transition"
              >
                <td className="px-4 py-3 font-medium">
                  {leave.employee_name}
                </td>

                <td className="px-4 py-3 capitalize">
                  {leave.leave_type}
                </td>

                <td className="px-4 py-3">
                  {new Date(leave.start_date).toLocaleDateString()}
                </td>

                <td className="px-4 py-3">
                  {new Date(leave.end_date).toLocaleDateString()}
                </td>

                <td className="px-4 py-3 text-center">
                  {leave.number_of_days}
                </td>

                <td className="px-4 py-3">
                  {leave.reason || "-"}
                </td>

                <td className="px-4 py-3">
                  {new Date(leave.created_at).toLocaleDateString()}
                </td>

                <td className="px-4 py-3">
                  <div className="flex gap-2 justify-center">
                    <button
                      onClick={() => approveLeave(leave.id)}
                      className="bg-green-600 hover:bg-green-700 text-white px-3 py-2 rounded-lg flex items-center gap-1"
                    >
                      <Check size={16} />
                      Approve
                    </button>

                    <button
                      onClick={() => rejectLeave(leave.id)}
                      className="bg-red-600 hover:bg-red-700 text-white px-3 py-2 rounded-lg flex items-center gap-1"
                    >
                      <X size={16} />
                      Reject
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}
  </>
)}
{/* All Leaves */}
{activeTab === "all" && (
  <>
    {loading ? (
      
         <PageLoader />
     
    ) : allLeaves.length === 0 ? (
      <div className="text-center py-8 text-gray-500">
        No Leave Records Found
      </div>
    ) : (
      <div className="overflow-x-auto">
        <table className="min-w-full border border-gray-200 rounded-lg">
          <thead className="bg-gray-100">
            <tr>
              <th className="px-4 py-3 text-left">Employee</th>
              <th className="px-4 py-3 text-left">Leave Type</th>
              <th className="px-4 py-3 text-left">Start</th>
              <th className="px-4 py-3 text-left">End</th>
              <th className="px-4 py-3 text-center">Days</th>
              <th className="px-4 py-3 text-center">Status</th>
              <th className="px-4 py-3 text-left">Reason</th>
              <th className="px-4 py-3 text-left">Applied On</th>
            </tr>
          </thead>

          <tbody>
            {allLeaves.map((leave) => (
              <tr
                key={leave.id}
                className="border-t hover:bg-gray-50 transition"
              >
                <td className="px-4 py-3 font-medium">
                  {leave.employee_name}
                </td>

                <td className="px-4 py-3 capitalize">
                  {leave.leave_type}
                </td>

                <td className="px-4 py-3">
                  {new Date(leave.start_date).toLocaleDateString()}
                </td>

                <td className="px-4 py-3">
                  {new Date(leave.end_date).toLocaleDateString()}
                </td>

                <td className="px-4 py-3 text-center">
                  {leave.number_of_days}
                </td>

                <td className="px-4 py-3 text-center">
                  <span
                    className={`px-3 py-1 rounded-full text-xs font-semibold ${getStatusColor(
                      leave.status
                    )}`}
                  >
                    {leave.status}
                  </span>
                </td>

                <td className="px-4 py-3">
                  {leave.reason || "-"}
                </td>

                <td className="px-4 py-3">
                  {new Date(leave.created_at).toLocaleDateString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}
  </>
)}

    </div>
  </div>
</div>
  );
}
    
