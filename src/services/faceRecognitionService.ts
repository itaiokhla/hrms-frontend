import api from "./api";
import type { IdentifyResponse } from "@/types/faceRecognition";


class FaceRecognitionService {
  async identify(image: Blob): Promise<IdentifyResponse> {
    const formData = new FormData();

    formData.append("file", image, "face.jpg");

    const response = await api.post<IdentifyResponse>(
      "/face-recognition/identify",
      formData,
      {
        headers: {
          "Content-Type": "multipart/form-data",
        },
      }
    );

    return response.data;
  }
}

export default new FaceRecognitionService();