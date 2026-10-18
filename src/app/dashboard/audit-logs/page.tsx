"use client";

import { useEffect, useState } from "react";
import { auditLogService } from "@/services/auditLogService";
import PageLoader from "@/components/PageLoader";

export default function AuditLogsPage() {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadLogs();
  }, []);

  const loadLogs = async () => {
  try {
    const logs = await auditLogService.getLogs();

    
    console.log("Logs:", logs);

    setLogs(logs);
  } catch (err) {
    console.error(err);
  } finally {
    setLoading(false);
  }
};

  return (
    <div className="p-6">

      <h1 className="text-3xl font-bold mb-6">
        Audit Logs
      </h1>

      <div className="bg-white rounded-xl shadow overflow-hidden">

        <table className="w-full">

          <thead className="bg-gray-100">

            <tr>
              <th className="p-3 text-left">Date</th>
              <th className="p-3 text-left">User</th>
              <th className="p-3 text-left">Module</th>
              <th className="p-3 text-left">Action</th>
              <th className="p-3 text-left">Description</th>
              <th className="p-3 text-left">IP</th>
            </tr>

          </thead>

          <tbody>

            {loading ? (

              <tr>
                <td colSpan={6} className="p-6 text-center">
                  return <PageLoader />;
                </td>
              </tr>

            ) : logs.length === 0 ? (

              <tr>
                <td colSpan={6} className="p-6 text-center">
                  No Logs Found
                </td>
              </tr>

            ) : (

              logs.map((log) => (

                <tr key={log.id} className="border-t">

                  <td className="p-3">
                    {new Date(log.created_at).toLocaleString()}
                  </td>

                  <td className="p-3">
                    {log.username}
                  </td>

                  <td className="p-3">
                    {log.module}
                  </td>

                  <td className="p-3">
                    {log.action}
                  </td>

                  <td className="p-3">
                    {log.description}
                  </td>

                  <td className="p-3">
                    {log.ip_address || "-"}
                  </td>

                </tr>

              ))

            )}

          </tbody>

        </table>

      </div>

    </div>
  );
}