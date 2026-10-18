  'use client';

  import { useEffect, useState } from 'react';
  import api from '@/services/api';
  import { Plus, Trash2, Edit2} from 'lucide-react';
  import BackButton from "@/components/BackButton";
  import toast from "react-hot-toast";
 
  
  import Swal from "sweetalert2";
 

  import { Download } from "lucide-react";
import { exportEmployees } from "@/services/employeeService";
  interface Employee {
    id: number;
    first_name: string;
    last_name: string;
    email: string;
    employee_id: string;
    position: string;
    phone?: string;
    hire_date: string;
    is_active: boolean;
    face_registered?: boolean;
  }

  

  

  export default function EmployeesPage() {
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [loading, setLoading] = useState(true);
    const [showForm, setShowForm] = useState(false);
    const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [saving, setSaving] = useState(false);
    
    const [formData, setFormData] = useState({
      first_name: '',
      last_name: '',
      email: '',
      employee_id: '',
      position: '',
      phone: '',
      username: '',
      password: '',
      department_id: 1,
      shift_id: 1,
      hire_date: new Date().toISOString().split('T')[0],
      base_salary: '',
    });

    useEffect(() => {
       setSearchTerm("");
      fetchEmployees();
    }, []);

    const fetchEmployees = async () => {
    try {
      setLoading(true);

      const response = await api.get('/employees?_=${Date.now()}');

      const employeesWithFace = await Promise.all(
        response.data.map(async (emp: Employee) => {
          try {
            const res = await api.get(
              `/face-recognition/employee/${emp.id}/encodings`
            );

            return {
              ...emp,
              face_registered: res.data.total_encodings > 0,
            };
          } catch {
            return {
              ...emp,
              face_registered: false,
            };
          }
        })
      );

      setEmployees(employeesWithFace);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

    const handleAddEmployee = async () => {
      setSaving(true);
      try {
        if (selectedEmployee) {
          await api.put(`/employees/${selectedEmployee.id}`, formData);
        } else {
          await api.post('/employees', formData);
        }
        setShowForm(false);
        setSelectedEmployee(null);
        resetForm();
        await fetchEmployees();
        setSearchTerm("");
        if (selectedEmployee) {
            toast.success("Employee updated successfully");
        } else {
            toast.success("Employee created successfully");
        }
      } catch (error: any) {
    console.error(error);
  }
  finally{
      setSaving(false);
  }
    };

    const handleDeleteEmployee = async (id: number) => {

    const result = await Swal.fire({
      title: "Delete Employee?",
      text: "This employee will be deactivated.",
      icon: "warning",
      showCancelButton: true,
      confirmButtonColor: "#2563eb",
      cancelButtonColor: "#ef4444",
      confirmButtonText: "Yes, Delete",
      cancelButtonText: "Cancel",
    });

    if (!result.isConfirmed) return;

    try {

      await api.delete(`/employees/${id}`);

      toast.success("Employee deleted successfully");

      fetchEmployees();

    } catch (error) {

        console.error(error);

    }

  };

  const handleExportEmployees = async () => {
  try {
    const blob = await exportEmployees();

    const url = window.URL.createObjectURL(blob);

    const link = document.createElement("a");

    link.href = url;
    link.download = "employees.xlsx";

    document.body.appendChild(link);

    link.click();

    link.remove();

    window.URL.revokeObjectURL(url);

    toast.success("Employees exported successfully");

  } catch (error) {
    console.error(error);
  }
};

  

    const handleEditEmployee = (employee: Employee) => {
      setSelectedEmployee(employee);
      setFormData({
        first_name: employee.first_name,
        last_name: employee.last_name,
        email: employee.email,
        employee_id: employee.employee_id,
        position: employee.position || '',
        phone: employee.phone || '',
        username: '',
        password: '',
        department_id: 0,
        shift_id: 0,
        hire_date: employee.hire_date,
        base_salary: '',
      });
      setShowForm(true);
    };

    const resetForm = () => {
      setFormData({
        first_name: '',
        last_name: '',
        email: '',
        employee_id: '',
        position: '',
        phone: '',
        username: '',
        password: '',
        department_id: 0,
        shift_id: 0,
        hire_date: new Date().toISOString().split('T')[0],
        base_salary: '',
      });
    };

    const filteredEmployees = employees.filter((emp) =>
      emp.first_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      emp.last_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      emp.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
      emp.employee_id.toLowerCase().includes(searchTerm.toLowerCase())
    );

    return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-100 p-8 space-y-8">

      <BackButton />

      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">

        <div>
          <h1 className="text-5xl font-extrabold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
            Employee Management
          </h1>

          <p className="text-gray-600 mt-2">
            Manage all employees in the system
          </p>
        </div>

        <button
          onClick={() => {
            setSelectedEmployee(null);
            resetForm();
            setShowForm(true);
          }}
          className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-semibold py-3 px-6 rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 flex items-center"
        >
          <Plus size={20} className="mr-2" />
          Add Employee
        </button>
          
        <button
          onClick={handleExportEmployees}
          className="bg-green-600 hover:bg-green-700 text-white font-semibold py-3 px-6 rounded-xl shadow-lg flex items-center"
        >
          <Download size={20} className="mr-2" />
          Export Excel
        </button>


      </div>
        

  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
    <div className="bg-white rounded-2xl shadow-xl p-6">
      <h3 className="text-gray-500 text-sm">Total Employees</h3>
      <p className="text-4xl font-bold text-blue-600">
        {employees.length}
      </p>
    </div>

    <div className="bg-white rounded-2xl shadow-xl p-6">
      <h3 className="text-gray-500 text-sm">Active Employees</h3>
      <p className="text-4xl font-bold text-green-600">
        {employees.filter(emp => emp.is_active).length}
      </p>
    </div>

    <div className="bg-white rounded-2xl shadow-xl p-6">
      <h3 className="text-gray-500 text-sm">Search Results</h3>
      <p className="text-4xl font-bold text-purple-600">
        {filteredEmployees.length}
      </p>
    </div>
  </div>


        {/* Search */}
        <div className="bg-white/80 backdrop-blur-xl rounded-2xl shadow-xl p-5 border border-white/20">
          <input
            type="search"
            name="employee-search"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}  
            placeholder="Search by name, email, or employee ID..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full px-5 py-3 border border-gray-200 rounded-xl focus:ring-4 focus:ring-blue-200 focus:border-blue-500 outline-none transition"
          />
        </div>

        {/* Form Modal */}
        {showForm && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-3xl shadow-2xl max-w-xl w-full p-8 max-h-[90vh] overflow-y-auto border border-gray-100">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">
                {selectedEmployee ? 'Edit Employee' : 'Add New Employee'}
              </h2>

              <div className="space-y-4">
                <input
                  type="text"
                  placeholder="First Name"
                  value={formData.first_name}
                  onChange={(e) => setFormData({ ...formData, first_name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                />
                <input
                  type="text"
                  placeholder="Last Name"
                  value={formData.last_name}
                  onChange={(e) => setFormData({ ...formData, last_name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                />
                <input
                  type="email"
                  placeholder="Email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                />
                <input
                  type="text"
                  placeholder="Employee ID"
                  value={formData.employee_id}
                  onChange={(e) => setFormData({ ...formData, employee_id: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                />
                <input
                  type="text"
                  placeholder="Position"
                  value={formData.position}
                  onChange={(e) => setFormData({ ...formData, position: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                />
                <input
    type="number"
    placeholder="Base Salary"
    value={formData.base_salary}
    onChange={(e) =>
      setFormData({ ...formData, base_salary: e.target.value })
    }
    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
  />
                <input
                  type="tel"
                  placeholder="Phone"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                />
                {!selectedEmployee && (
                  <>
                    <input
                      type="text"
                      placeholder="Username"
                      value={formData.username}
                      onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    />
                    <input
                      type="password"
                      placeholder="Password"
                      value={formData.password}
                      onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    />
                  </>
                )}
              </div>

              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => setShowForm(false)}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAddEmployee}
                  disabled={saving}
                  className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-50"
                >
                  { saving ? "Saving..." : selectedEmployee ? 'Update' : 'Add'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Employees Table */}
        <div className="bg-white/90 backdrop-blur-xl rounded-3xl shadow-2xl overflow-hidden border border-white/20">
          {loading ? (
            <div className="p-8 text-center text-gray-600"><div className="flex justify-center py-12">
    <div className="animate-spin rounded-full h-12 w-12 border-b-4 border-blue-600"></div>
  </div>
  </div>
          ) : filteredEmployees.length === 0 ? (
            <div className="p-8 text-center text-gray-600">No employees found</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gradient-to-r from-blue-600 to-indigo-600">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-white uppercase">Name</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-white uppercase">Employee ID</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-white uppercase">Email</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-white uppercase">
  Face
  </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-white uppercase">Position</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-white uppercase">Phone</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-white uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {filteredEmployees.map((emp) => (
                    <tr
    key={emp.id}
    className="hover:bg-blue-50 transition-all duration-200"
  >
                      <td className="px-6 py-4">
    <div>
      <p className="font-semibold text-gray-900">
        {emp.first_name} {emp.last_name}
      </p>

      <p className="text-xs text-gray-500">
        {emp.position || 'Employee'}
      </p>
    </div>
  </td>
                      <td className="px-6 py-4 text-sm text-gray-600">{emp.employee_id}</td>
                      <td className="px-6 py-4 text-sm text-gray-600">{emp.email}</td>
                      <td className="px-6 py-4">

    {emp.face_registered ? (

      <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-semibold text-green-700">

        🟢 Registered

      </span>

    ) : (

      <span className="rounded-full bg-red-100 px-3 py-1 text-xs font-semibold text-red-700">

        🔴 Not Registered

      </span>

    )}

  </td>
                      <td className="px-6 py-4 text-sm text-gray-600">{emp.position || '-'}</td>
                      <td className="px-6 py-4 text-sm text-gray-600">{emp.phone || '-'}</td>
                      <td className="px-6 py-4 text-right space-x-2">
                        <button
                          onClick={() => handleEditEmployee(emp)}
                          className="text-blue-600 hover:text-blue-900 inline-flex"
                        >
                          <Edit2 size={18} />
                        </button>
                        <button
                          onClick={() => handleDeleteEmployee(emp.id)}
                          className="text-red-600 hover:text-red-900 inline-flex"
                        >
                          <Trash2 size={18} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    );
  }
