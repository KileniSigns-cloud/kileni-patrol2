import { useState } from 'react';

export function useCamera() {
  const [photos, setPhotos] = useState<string[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);

  const capture = async (file: File) => {
    return new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = reader.result as string;
        setPhotos(prev => [...prev, base64]);
        setFiles(prev => [...prev, file]);
        resolve(base64);
      };
      reader.readAsDataURL(file);
    });
  };

  const clear = () => {
    setPhotos([]);
    setFiles([]);
  };

  return { photos, files, uploading, capture, clear };
}
