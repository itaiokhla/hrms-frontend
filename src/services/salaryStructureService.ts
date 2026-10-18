import api from "./api";
import type {
  SalaryStructure,
  SalaryStructureCreate,
} from "@/types/salaryStructure";

class SalaryStructureService {
  async getAll(): Promise<SalaryStructure[]> {
    const response =
      await api.get<SalaryStructure[]>("/salary-structure/");

    return response.data;
  }

  async create(
    data: SalaryStructureCreate
  ): Promise<SalaryStructure> {
    const response =
      await api.post<SalaryStructure>(
        "/salary-structure/",
        data
      );

    return response.data;
  }

  async update(
    id: number,
    data: Partial<SalaryStructureCreate>
  ): Promise<SalaryStructure> {
    const response =
      await api.put<SalaryStructure>(
        `/salary-structure/${id}`,
        data
      );

    return response.data;
  }

  async delete(id: number): Promise<void> {
    await api.delete(`/salary-structure/${id}`);
  }
}

export default new SalaryStructureService();