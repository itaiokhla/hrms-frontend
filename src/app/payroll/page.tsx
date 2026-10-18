'use client';

import { useEffect, useState } from 'react';
import api from '@/services/api';
import { Download, Eye, CheckCircle, Clock, FileText, TrendingUp, AlertCircle } from 'lucide-react';
import BackButton from "@/components/BackButton";

interface Payroll {
  id: number;
  employee_id: number;
  salary_month: string;
  gross_salary: number;
  net_salary: number;
  status: 'draft' | 'approved' | 'processed' | 'paid';
  created_at: string;
}

interface PayrollSummary {
  month: string;
  total_employees: number;
  total_gross_salary: number;
  total_deductions: number;
  total_net_salary: number;
  status_breakdown: Record<string, number>;
  average_salary: number;
}

interface SalarySlip {
  payroll_id: number;
  employee: {
    id: number;
    name: string;
    employee_id: string;
    department: string;
    designation: string;
  };
  salary_month: string;
  salary_components: {
    basic_salary: number;
    house_rent_allowance: number;
    dearness_allowance: number;
    conveyance_allowance: number;
    other_allowances: number;
    overtime_amount: number;
  };
  gross_salary: number;
  deductions: {
    provident_fund: number;
    insurance: number;
    professional_tax: number;
    income_tax: number;
    other_deductions: number;
  };
  total_deductions: number;
  net_salary: number;
  attendance: {
    working_days: number;
    present_days: number;
    absent_days: number;
    leave_days: number;
  };
  status: string;
  generated_date: string;
}

export default function PayrollPage() {
  const [payrolls, setPayrolls] = useState<Payroll[]>([]);
  const [summary, setSummary] = useState<PayrollSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState(new Date().toISOString().slice(0, 7));
  const [showGenerateForm, setShowGenerateForm] = useState(false);

  const [salarySlip, setSalarySlip] = useState<SalarySlip | null>(null);
  const [showSlipModal, setShowSlipModal] = useState(false);
  const [generatingAll, setGeneratingAll] = useState(false);
  const [processingBulk, setProcessingBulk] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('');

  useEffect(() => {
    fetchPayrolls();
    fetchSummary();
  }, [selectedMonth, statusFilter]);

  const fetchPayrolls = async () => {
    try {
      setLoading(true);
      const [year, month] = selectedMonth.split('-');
      const url = statusFilter
  ? `/payroll/records?year=${year}&month=${month}&status=${statusFilter}`
  : `/payroll/month/${year}/${month}`;
      const response = await api.get(url);
      setPayrolls(response.data);
    } catch (error: any) {
  console.error("FULL ERROR:", error);
  console.error("URL:", error.config?.url);
  console.error("DATA:", error.response?.data);

  alert(
    `URL: ${error.config?.url}\n\n` +
    JSON.stringify(error.response?.data)
  );
} finally {
      setLoading(false);
    }
  };

  const fetchSummary = async () => {
    try {
      const [year, month] = selectedMonth.split('-');
      const response = await api.get(`/payroll/summary/${year}/${month}`);
      setSummary(response.data);
    } catch (error) {
      console.error('Error fetching summary:', error);
    }
  };

  const generatePayrollForMonth = async () => {
    try {
      setGeneratingAll(true);
      const [year, month] = selectedMonth.split('-');
      const response = await api.post(
  `/payroll/generate-month?year=${year}&month=${month}`
);
      alert(`Payroll generated: ${response.data.summary.generated} employees`);
      await fetchPayrolls();
      await fetchSummary();
      setShowGenerateForm(false);
    } catch (error: any) {
  console.error("FULL ERROR:", error);
  console.error("URL:", error.config?.url);
  console.error("DATA:", error.response?.data);

  alert(
    `URL: ${error.config?.url}\n\n` +
    JSON.stringify(error.response?.data)
  );
}   finally {
      setGeneratingAll(false);
    }
  };

  const processBulkPayroll = async () => {
    try {
      setProcessingBulk(true);
      const [year, month] = selectedMonth.split('-');
      const response = await api.post(
  `/payroll/process-bulk?year=${year}&month=${month}&status=approved`
);
      alert(`Payroll processed: ${response.data.summary.processed} records`);
      await fetchPayrolls();
      await fetchSummary();
    } catch (error: any) {
      const message = error.response?.data?.detail || 'Failed to process payroll';
      alert(message);
    } finally {
      setProcessingBulk(false);
    }
  };

  const fetchSalarySlip = async (payrollId: number) => {
    try {
      const response = await api.get(`/payroll/${payrollId}/slip`);
      setSalarySlip(response.data);
      setShowSlipModal(true);
    } catch (error) {
      console.error('Error fetching salary slip:', error);
      alert('Failed to fetch salary slip');
    }
  };

  const downloadSalarySlip = async (payrollId: number) => {
    try {
      const response = await api.get(`/payroll/${payrollId}/slip`);
      const slip = response.data;
      
      // Create PDF content as HTML string
      const htmlContent = generateSalarySlipHTML(slip);
      
      // Use window.print or create a blob for PDF download
      const printWindow = window.open('', '', 'width=800,height=600');
      if (printWindow) {
        printWindow.document.write(htmlContent);
        printWindow.document.close();
        printWindow.focus();
        printWindow.print();
      }
    } catch (error) {
      console.error('Error downloading salary slip:', error);
      alert('Failed to download salary slip');
    }
  };

  const generateSalarySlipHTML = (slip: SalarySlip) => {
    const currentDate = new Date().toLocaleDateString('en-IN');
    return `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Salary Slip - ${slip.employee.name}</title>
          <style>
            * { margin: 0; padding: 0; }
            body { font-family: Arial, sans-serif; color: #333; }
            .container { max-width: 800px; margin: 20px auto; padding: 20px; border: 1px solid #ddd; }
            .header { text-align: center; margin-bottom: 20px; border-bottom: 2px solid #1e3a8a; padding-bottom: 10px; }
            .header h1 { color: #1e3a8a; margin-bottom: 5px; }
            .header p { color: #666; font-size: 12px; }
            .emp-info { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 20px; }
            .section { margin-bottom: 20px; }
            .section-title { background: #f0f0f0; padding: 10px; font-weight: bold; margin-bottom: 10px; }
            table { width: 100%; border-collapse: collapse; margin-top: 10px; }
            td { padding: 8px; border-bottom: 1px solid #ddd; }
            .label { font-weight: bold; width: 50%; }
            .total-row { font-weight: bold; background: #f9f9f9; }
            .footer { text-align: center; margin-top: 30px; font-size: 12px; color: #666; }
            @media print { body { margin: 0; } }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>SALARY SLIP</h1>
              <p>For the Month of ${slip.salary_month}</p>
              <p>Generated on ${currentDate}</p>
            </div>

            <div class="emp-info">
              <div>
                <p><strong>Employee Name:</strong> ${slip.employee.name}</p>
                <p><strong>Employee ID:</strong> ${slip.employee.employee_id}</p>
                <p><strong>Department:</strong> ${slip.employee.department}</p>
                <p><strong>Designation:</strong> ${slip.employee.designation}</p>
              </div>
              <div>
                <p><strong>Month:</strong> ${slip.salary_month}</p>
                <p><strong>Status:</strong> ${slip.status.toUpperCase()}</p>
                <p><strong>Working Days:</strong> ${slip.attendance.working_days}</p>
                <p><strong>Present Days:</strong> ${slip.attendance.present_days}</p>
              </div>
            </div>

            <div class="section">
              <div class="section-title">Earnings</div>
              <table>
                <tr>
                  <td class="label">Basic Salary</td>
                  <td>₹${slip.salary_components.basic_salary.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>
                </tr>
                <tr>
                  <td class="label">House Rent Allowance</td>
                  <td>₹${slip.salary_components.house_rent_allowance.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>
                </tr>
                <tr>
                  <td class="label">Dearness Allowance</td>
                  <td>₹${slip.salary_components.dearness_allowance.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>
                </tr>
                <tr>
                  <td class="label">Conveyance Allowance</td>
                  <td>₹${slip.salary_components.conveyance_allowance.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>
                </tr>
                <tr>
                  <td class="label">Other Allowances</td>
                  <td>₹${slip.salary_components.other_allowances.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>
                </tr>
                <tr>
                  <td class="label">Overtime Amount</td>
                  <td>₹${slip.salary_components.overtime_amount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>
                </tr>
                <tr class="total-row">
                  <td class="label">Gross Salary</td>
                  <td>₹${slip.gross_salary.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>
                </tr>
              </table>
            </div>

            <div class="section">
              <div class="section-title">Deductions</div>
              <table>
                <tr>
                  <td class="label">Provident Fund</td>
                  <td>₹${slip.deductions.provident_fund.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>
                </tr>
                <tr>
                  <td class="label">Insurance</td>
                  <td>₹${slip.deductions.insurance.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>
                </tr>
                <tr>
                  <td class="label">Professional Tax</td>
                  <td>₹${slip.deductions.professional_tax.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>
                </tr>
                <tr>
                  <td class="label">Income Tax</td>
                  <td>₹${slip.deductions.income_tax.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>
                </tr>
                <tr>
                  <td class="label">Other Deductions</td>
                  <td>₹${slip.deductions.other_deductions.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>
                </tr>
                <tr class="total-row">
                  <td class="label">Total Deductions</td>
                  <td>₹${slip.total_deductions.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>
                </tr>
              </table>
            </div>

            <div class="section">
              <table>
                <tr class="total-row" style="background: #dbeafe; font-size: 16px;">
                  <td class="label">Net Salary (After Deductions)</td>
                  <td>₹${slip.net_salary.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>
                </tr>
              </table>
            </div>

            <div class="section">
              <div class="section-title">Attendance Summary</div>
              <table>
                <tr>
                  <td class="label">Working Days</td>
                  <td>${slip.attendance.working_days}</td>
                </tr>
                <tr>
                  <td class="label">Days Present</td>
                  <td>${slip.attendance.present_days}</td>
                </tr>
                <tr>
                  <td class="label">Days Absent</td>
                  <td>${slip.attendance.absent_days}</td>
                </tr>
                <tr>
                  <td class="label">Leave Days</td>
                  <td>${slip.attendance.leave_days}</td>
                </tr>
              </table>
            </div>

            <div class="footer">
              <p>This is a system-generated salary slip. For queries, contact HR department.</p>
            </div>
          </div>
        </body>
      </html>
    `;
  };

  const approvePayroll = async (payrollId: number) => {
    try {
      await api.post(`/payroll/${payrollId}/approve`);
      alert('Payroll approved successfully');
      await fetchPayrolls();
      await fetchSummary();
    } catch (error) {
      alert('Failed to approve payroll');
    }
  };

  const processPayroll = async (payrollId: number) => {
    try {
      await api.post(`/payroll/${payrollId}/process`);
      alert('Payroll processed successfully');
      await fetchPayrolls();
      await fetchSummary();
    } catch (error) {
      alert('Failed to process payroll');
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'draft':
        return 'bg-gray-100 text-gray-800';
      case 'approved':
        return 'bg-blue-100 text-blue-800';
      case 'processed':
        return 'bg-green-100 text-green-800';
      case 'paid':
        return 'bg-purple-100 text-purple-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  return (
  <div className="space-y-6">

    <BackButton />

    {/* Header */}
    <div className="flex items-center justify-between">
      <div>
        <h1 className="text-4xl font-bold text-gray-900">
          Payroll Management
        </h1>

        <p className="text-gray-600 mt-2">
          Process and manage monthly salary payroll
        </p>
      </div>
        <div className="flex gap-3">
          <button
            onClick={() => setShowGenerateForm(true)}
            className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded-lg flex items-center"
          >
            <Download size={20} className="mr-2" />
            Generate
          </button>
          <button
            onClick={processBulkPayroll}
            disabled={processingBulk}
            className="bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white font-semibold py-2 px-4 rounded-lg flex items-center"
          >
            <CheckCircle size={20} className="mr-2" />
            {processingBulk ? 'Processing...' : 'Process All'}
          </button>
        </div>
      </div>

      {/* Month Selection & Filter */}
      <div className="bg-white rounded-lg shadow p-4 flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <label className="font-semibold text-gray-700">Month:</label>
          <input
            type="month"
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="font-semibold text-gray-700">Status:</label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
          >
            <option value="">All</option>
            <option value="draft">Draft</option>
            <option value="approved">Approved</option>
            <option value="processed">Processed</option>
            <option value="paid">Paid</option>
          </select>
        </div>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
          <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-lg shadow p-6 border-l-4 border-blue-600">
            <p className="text-blue-600 text-sm font-semibold">Total Employees</p>
            <p className="text-3xl font-bold text-gray-900 mt-2">{summary.total_employees}</p>
          </div>
          <div className="bg-gradient-to-br from-green-50 to-green-100 rounded-lg shadow p-6 border-l-4 border-green-600">
            <p className="text-green-600 text-sm font-semibold">Total Gross</p>
            <p className="text-2xl font-bold text-gray-900 mt-2">₹{(summary.total_gross_salary / 100000).toFixed(2)}L</p>
          </div>
          <div className="bg-gradient-to-br from-red-50 to-red-100 rounded-lg shadow p-6 border-l-4 border-red-600">
            <p className="text-red-600 text-sm font-semibold">Total Deductions</p>
            <p className="text-2xl font-bold text-gray-900 mt-2">₹{(summary.total_deductions / 100000).toFixed(2)}L</p>
          </div>
          <div className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-lg shadow p-6 border-l-4 border-purple-600">
            <p className="text-purple-600 text-sm font-semibold">Total Net</p>
            <p className="text-2xl font-bold text-gray-900 mt-2">₹{(summary.total_net_salary / 100000).toFixed(2)}L</p>
          </div>
          <div className="bg-gradient-to-br from-yellow-50 to-yellow-100 rounded-lg shadow p-6 border-l-4 border-yellow-600">
            <p className="text-yellow-600 text-sm font-semibold">Avg Salary</p>
            <p className="text-2xl font-bold text-gray-900 mt-2">₹{(summary.average_salary / 1000).toFixed(1)}K</p>
          </div>
        </div>
      )}

      {/* Status Breakdown */}
      {summary && (
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
            <TrendingUp size={20} className="mr-2" />
            Status Breakdown
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {Object.entries(summary.status_breakdown).map(([status, count]) => (
              <div key={status} className={`p-4 rounded-lg ${getStatusColor(status)} text-center`}>
                <p className="text-sm font-semibold">{status.charAt(0).toUpperCase() + status.slice(1)}</p>
                <p className="text-2xl font-bold">{count}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Payroll Table */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-gray-600">
            <Clock className="animate-spin mx-auto mb-2" />
            Loading payroll records...
          </div>
        ) : payrolls.length === 0 ? (
          <div className="p-8 text-center text-gray-600 flex items-center justify-center gap-2">
            <AlertCircle size={20} />
            No payroll records found
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase">Employee ID</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase">Gross</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase">Deductions</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase">Net Salary</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase">Status</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-700 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {payrolls.map((payroll) => (
                  <tr key={payroll.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 text-sm font-medium text-gray-900">{payroll.employee_id}</td>
                    <td className="px-6 py-4 text-sm text-gray-600">
                      ₹{payroll.gross_salary.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600">
                      ₹{(payroll.gross_salary - payroll.net_salary).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                    </td>
                    <td className="px-6 py-4 text-sm font-semibold text-gray-900">
                      ₹{payroll.net_salary.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                    </td>
                    <td className="px-6 py-4">
                      <span className={`px-3 py-1 rounded-full text-xs font-semibold ${getStatusColor(payroll.status)}`}>
                        {payroll.status.charAt(0).toUpperCase() + payroll.status.slice(1)}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right space-x-2">
                      <button
                        onClick={() => fetchSalarySlip(payroll.id)}
                        className="text-blue-600 hover:text-blue-900 inline-flex p-1 hover:bg-blue-50 rounded"
                        title="View Slip"
                      >
                        <Eye size={18} />
                      </button>
                      <button
                        onClick={() => downloadSalarySlip(payroll.id)}
                        className="text-green-600 hover:text-green-900 inline-flex p-1 hover:bg-green-50 rounded"
                        title="Download PDF"
                      >
                        <Download size={18} />
                      </button>
                      {payroll.status === 'draft' && (
                        <button
                          onClick={() => approvePayroll(payroll.id)}
                          className="text-yellow-600 hover:text-yellow-900 inline-flex p-1 hover:bg-yellow-50 rounded"
                          title="Approve"
                        >
                          <CheckCircle size={18} />
                        </button>
                      )}
                      {payroll.status === 'approved' && (
                        <button
                          onClick={() => processPayroll(payroll.id)}
                          className="text-purple-600 hover:text-purple-900 inline-flex p-1 hover:bg-purple-50 rounded"
                          title="Process"
                        >
                          <FileText size={18} />
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

      {/* Generate Modal */}
      {showGenerateForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">
              Generate Payroll
            </h2>
            <p className="text-gray-600 mb-6">
              Generate payroll for all active employees for {new Date(selectedMonth + '-01').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowGenerateForm(false)}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={generatePayrollForMonth}
                disabled={generatingAll}
                className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white rounded-lg"
              >
                {generatingAll ? 'Generating...' : 'Generate'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Salary Slip Modal */}
      {showSlipModal && salarySlip && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full p-6 max-h-96 overflow-y-auto">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">Salary Slip - {salarySlip.employee.name}</h2>

            <div className="grid grid-cols-2 gap-4 mb-6 border-b pb-4">
              <div>
                <p className="text-sm text-gray-600">Employee ID</p>
                <p className="font-semibold">{salarySlip.employee.employee_id}</p>
              </div>
              <div>
                <p className="text-sm text-gray-600">Department</p>
                <p className="font-semibold">{salarySlip.employee.department}</p>
              </div>
              <div>
                <p className="text-sm text-gray-600">Designation</p>
                <p className="font-semibold">{salarySlip.employee.designation}</p>
              </div>
              <div>
                <p className="text-sm text-gray-600">Month</p>
                <p className="font-semibold">{salarySlip.salary_month}</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-6 mb-6">
              <div>
                <h3 className="font-semibold text-gray-900 mb-3">Earnings</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between"><span>Basic:</span><span>₹{salarySlip.salary_components.basic_salary.toLocaleString()}</span></div>
                  <div className="flex justify-between"><span>HRA:</span><span>₹{salarySlip.salary_components.house_rent_allowance.toLocaleString()}</span></div>
                  <div className="flex justify-between"><span>DA:</span><span>₹{salarySlip.salary_components.dearness_allowance.toLocaleString()}</span></div>
                  <div className="flex justify-between font-semibold border-t pt-2"><span>Gross:</span><span>₹{salarySlip.gross_salary.toLocaleString()}</span></div>
                </div>
              </div>

              <div>
                <h3 className="font-semibold text-gray-900 mb-3">Deductions</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between"><span>PF:</span><span>₹{salarySlip.deductions.provident_fund.toLocaleString()}</span></div>
                  <div className="flex justify-between"><span>Tax:</span><span>₹{salarySlip.deductions.income_tax.toLocaleString()}</span></div>
                  <div className="flex justify-between"><span>Insurance:</span><span>₹{salarySlip.deductions.insurance.toLocaleString()}</span></div>
                  <div className="flex justify-between font-semibold border-t pt-2"><span>Total:</span><span>₹{salarySlip.total_deductions.toLocaleString()}</span></div>
                </div>
              </div>
            </div>

            <div className="bg-blue-50 p-4 rounded-lg mb-6">
              <p className="text-sm text-gray-600">Net Salary (Take Home)</p>
              <p className="text-3xl font-bold text-blue-600">₹{salarySlip.net_salary.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</p>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => downloadSalarySlip(salarySlip.payroll_id)}
                className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg flex items-center justify-center"
              >
                <Download size={18} className="mr-2" />
                Download PDF
              </button>
              <button
                onClick={() => setShowSlipModal(false)}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
