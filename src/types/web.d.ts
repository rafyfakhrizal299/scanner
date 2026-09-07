type BarcodeDetectorOptions = {
  formats?: string[];
};

type DetectedBarcode = {
  rawValue: string;
  format: string;
};

declare class BarcodeDetector {
  constructor(options?: BarcodeDetectorOptions);
  detect(source: ImageBitmapSource): Promise<DetectedBarcode[]>;
  static getSupportedFormats(): Promise<string[]>;
}

interface SaveFileHandleLike {
  createWritable: () => Promise<{
    write: (data: Blob) => Promise<void>;
    close: () => Promise<void>;
  }>;
}

interface DirectoryHandleLike {
  kind: "directory";
  name: string;
  getDirectoryHandle: (
    name: string,
    options?: { create?: boolean }
  ) => Promise<DirectoryHandleLike>;
  getFileHandle: (
    name: string,
    options?: { create?: boolean }
  ) => Promise<SaveFileHandleLike>;
  queryPermission: (descriptor: {
    mode: "read" | "readwrite";
  }) => Promise<"granted" | "denied" | "prompt">;
  requestPermission: (descriptor: {
    mode: "read" | "readwrite";
  }) => Promise<"granted" | "denied" | "prompt">;
}

interface Window {
  __PACKSCAN_HYDRATED?: boolean;
  BarcodeDetector?: typeof BarcodeDetector;
  showSaveFilePicker?: (options?: {
    suggestedName?: string;
    types?: { description?: string; accept: Record<string, string[]> }[];
  }) => Promise<SaveFileHandleLike>;
  showDirectoryPicker?: (options?: {
    id?: string;
    mode?: "read" | "readwrite";
  }) => Promise<DirectoryHandleLike>;
}
