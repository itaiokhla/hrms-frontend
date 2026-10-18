import api from "./api";

class AuthService {
  async changePassword(
    currentPassword: string,
    newPassword: string
  ) {
    const response = await api.put(
      "/auth/change-password",
      {
        current_password: currentPassword,
        new_password: newPassword,
      }
    );

    return response.data;
  }
}

export default new AuthService();