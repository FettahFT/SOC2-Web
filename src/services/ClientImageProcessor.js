/**
 * Client-side Image Processor for Steganography
 * Supports two methods:
 * 1. Generate: Creates a new noisy image from the file data. High capacity, not subtle.
 * 2. LSB: Hides file data in the least significant bits of an existing carrier image. Low capacity, very subtle.
 */
class ClientImageProcessor {
  static SIGNATURE = "SC";
  static ENCODING_TYPE_GENERATED = 0;
  static ENCODING_TYPE_LSB = 1;

  static MAX_FILE_SIZE = 1024 * 1024 * 1024; // 1GB
  static BYTES_PER_PIXEL_GENERATED = 3; // RGB
  static BITS_PER_PIXEL_LSB = 3; // LSB of R, G, B
  static SHA256_SIZE = 32;

  /**
   * Hides a file inside an existing carrier image using LSB steganography.
   * @param {File} payloadFile - The file to hide.
   * @param {File} carrierImageFile - The image to hide the file in.
   * @param {string|null} password - Optional password for encryption.
   * @param {function|null} onProgress - Progress callback.
   * @returns {Promise<Blob>} A new PNG blob with the hidden data.
   */
  static async hideInExistingImageAsync(payloadFile, carrierImageFile, password = null, onProgress = null) {
    onProgress?.(5);
    const [payloadData, carrierImg] = await Promise.all([
      this._readFileAsArrayBuffer(payloadFile),
      this._loadImage(carrierImageFile),
    ]);
    onProgress?.(15);

    const fileName = payloadFile.name;
    const isEncrypted = password != null;

    // Process payload (hash, maybe encrypt)
    const sha256Hash = await this._computeSHA256(payloadData);
    let processedData = payloadData;
    if (isEncrypted) {
      processedData = await this._encryptData(payloadData, password);
    }
    onProgress?.(30);

    // Create header and combine with data
    const header = this._createHeader(processedData.byteLength, fileName, sha256Hash, isEncrypted, this.ENCODING_TYPE_LSB);
    const totalData = new Uint8Array(header.length + processedData.byteLength);
    totalData.set(header, 0);
    totalData.set(new Uint8Array(processedData), header.length);
    onProgress?.(40);

    // Check if the carrier image has enough capacity
    const carrierCapacity = Math.floor((carrierImg.width * carrierImg.height * this.BITS_PER_PIXEL_LSB) / 8);
    if (totalData.length > carrierCapacity) {
      throw new Error(`File is too large for the selected carrier image. Required: ${totalData.length} bytes, Available: ${carrierCapacity} bytes.`);
    }
    onProgress?.(50);

    // Encode data into the carrier image
    const canvas = document.createElement('canvas');
    canvas.width = carrierImg.width;
    canvas.height = carrierImg.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(carrierImg, 0, 0);
    const imageData = ctx.getImageData(0, 0, carrierImg.width, carrierImg.height);
    onProgress?.(60);

    this._writeBitsToImageData(imageData.data, totalData);
    onProgress?.(80);

    ctx.putImageData(imageData, 0, 0);
    onProgress?.(90);

    return new Promise((resolve) => {
      canvas.toBlob((blob) => {
        onProgress?.(100);
        resolve(blob);
      }, 'image/png');
    });
  }

  /**
   * Creates a new carrier image from the file data (original method).
   * @param {File} file - The file to hide.
   * @param {string|null} password - Optional password for encryption.
   * @param {function|null} onProgress - Progress callback.
   * @returns {Promise<Blob>} PNG blob containing the hidden data.
   */
  static async createCarrierImageAsync(file, password = null, onProgress = null) {
    const fileData = await this._readFileAsArrayBuffer(file);
    if (fileData.byteLength > this.MAX_FILE_SIZE) throw new Error('File too large.');
    onProgress?.(10);

    const sha256Hash = await this._computeSHA256(fileData);
    onProgress?.(20);

    let processedData = fileData;
    if (password) {
      processedData = await this._encryptData(fileData, password);
      onProgress?.(30);
    }

    const header = this._createHeader(processedData.byteLength, file.name, sha256Hash, !!password, this.ENCODING_TYPE_GENERATED);
    onProgress?.(40);

    const totalData = new Uint8Array(header.length + processedData.byteLength);
    totalData.set(header, 0);
    totalData.set(new Uint8Array(processedData), header.length);
    onProgress?.(50);

    const pixelCount = Math.ceil(totalData.length / this.BYTES_PER_PIXEL_GENERATED);
    const imageSize = Math.ceil(Math.sqrt(pixelCount));
    onProgress?.(60);

    const canvas = document.createElement('canvas');
    canvas.width = imageSize;
    canvas.height = imageSize;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, imageSize, imageSize);

    const imageData = ctx.getImageData(0, 0, imageSize, imageSize);
    this._writeBytesDirectly(imageData.data, totalData);
    ctx.putImageData(imageData, 0, 0);
    onProgress?.(90);

    return new Promise((resolve) => {
      canvas.toBlob((blob) => {
        onProgress?.(100);
        resolve(blob);
      }, 'image/png');
    });
  }

  /**
   * Extracts a file from any supported carrier image.
   * @param {File} imageFile - PNG file with hidden data.
   * @param {string|null} password - Optional password.
   * @param {function|null} onProgress - Progress callback.
   * @returns {Promise<{fileName: string, data: Uint8Array}>}
   */
  static async extractFileAsync(imageFile, password = null, onProgress = null) {
    const img = await this._loadImage(imageFile);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = img.width;
    canvas.height = img.height;
    ctx.drawImage(img, 0, 0);

    try {
      const imageData = ctx.getImageData(0, 0, img.width, img.height);
      const pixelData = imageData.data;
      onProgress?.(20);

      const headerInfo = this._readHeader(pixelData);
      onProgress?.(40);

      let fileDataFromImage;
      if (headerInfo.encodingType === this.ENCODING_TYPE_LSB) {
        fileDataFromImage = this._readBitsFromPixelData(pixelData, headerInfo.totalHeaderSize, headerInfo.fileSize);
      } else {
        fileDataFromImage = this._readBytesDirectly(pixelData, headerInfo.totalHeaderSize, headerInfo.fileSize);
      }
      onProgress?.(60);

      let finalData = fileDataFromImage;
      if (headerInfo.isEncrypted) {
        if (!password) throw new Error('File is encrypted, but no password was provided.');
        try {
          finalData = await this._decryptData(fileDataFromImage, password);
        } catch (e) {
          throw new Error('Decryption failed. The password may be incorrect.');
        }
      }
      onProgress?.(80);

      const computedHash = await this._computeSHA256(finalData);
      if (!this._arraysEqual(computedHash, headerInfo.sha256Hash)) {
        throw new Error('SHA256 hash mismatch. The file is likely corrupted.');
      }
      
      onProgress?.(100);
      return { fileName: headerInfo.fileName, data: finalData };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Extracts metadata from a carrier image.
   * @param {File} imageFile - PNG file.
   * @returns {Promise<Object>} Metadata object.
   */
  static async extractMetadataAsync(imageFile) {
    const img = await this._loadImage(imageFile);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = img.width;
    canvas.height = img.height;
    ctx.drawImage(img, 0, 0);
    const pixelData = ctx.getImageData(0, 0, img.width, img.height).data;
    return this._readHeader(pixelData);
  }

  // --- INTERNAL HELPERS ---

  // Header Management
  static _createHeader(fileSize, fileName, sha256Hash, isEncrypted, encodingType) {
    const fileNameBytes = new TextEncoder().encode(fileName);
    if (fileNameBytes.length > 255) throw new Error('Filename too long');

    const header = new Uint8Array(512); // Allocate a generous fixed-size buffer
    let offset = 0;

    // Signature (2 bytes)
    header.set(new TextEncoder().encode(this.SIGNATURE), offset);
    offset += 2;

    // Encoding Type (1 byte)
    header[offset++] = encodingType;

    // File size (8 bytes, little-endian)
    const sizeView = new DataView(new ArrayBuffer(8));
    // eslint-disable-next-line no-undef
    sizeView.setBigUint64(0, BigInt(fileSize), true);
    header.set(new Uint8Array(sizeView.buffer), offset);
    offset += 8;

    // Filename length (1 byte)
    header[offset++] = fileNameBytes.length;

    // Filename (up to 255 bytes)
    header.set(fileNameBytes, offset);
    offset += fileNameBytes.length;

    // IsEncrypted (1 byte)
    header[offset++] = isEncrypted ? 1 : 0;

    // SHA256 hash (32 bytes)
    header.set(sha256Hash, offset);
    offset += this.SHA256_SIZE;

    // Return only the portion of the buffer that was used
    return header.slice(0, offset);
  }

  static _readHeader(pixelData) {
    // The header itself is small, so we can read it using the appropriate method
    // We assume the header is always written directly for simplicity, even in LSB mode.
    const headerSignature = this._readBytesDirectly(pixelData, 0, 3);
    const signature = String.fromCharCode(headerSignature[0], headerSignature[1]);
    if (signature !== this.SIGNATURE) throw new Error('Invalid signature. Not a valid carrier image.');
    
    const encodingType = headerSignature[2];
    let readFunc = (encodingType === this.ENCODING_TYPE_LSB) 
      ? (offset, len) => this._readBitsFromPixelData(pixelData, offset, len)
      : (offset, len) => this._readBytesDirectly(pixelData, offset, len);

    let offset = 3;
    const fileSizeData = readFunc(offset, 8);
    // eslint-disable-next-line no-undef
    const fileSize = new DataView(fileSizeData.buffer).getBigUint64(0, true);
    offset += 8;

    const fileNameLengthData = readFunc(offset, 1);
    const fileNameLength = fileNameLengthData[0];
    offset += 1;

    const fileNameBytes = readFunc(offset, fileNameLength);
    const fileName = new TextDecoder().decode(fileNameBytes);
    offset += fileNameLength;

    const isEncryptedData = readFunc(offset, 1);
    const isEncrypted = isEncryptedData[0] === 1;
    offset += 1;

    const sha256Hash = readFunc(offset, this.SHA256_SIZE);
    offset += this.SHA256_SIZE;

    return {
      signature,
      encodingType,
      fileSize: Number(fileSize),
      fileName,
      isEncrypted,
      sha256Hash,
      totalHeaderSize: offset
    };
  }

  // Data I/O: Direct (Generated Mode)
  static _writeBytesDirectly(imageData, bytes) {
    let byteIndex = 0;
    for (let i = 0; i < imageData.length && byteIndex < bytes.length; i += 4) {
      imageData[i] = bytes[byteIndex++];
      if (byteIndex < bytes.length) imageData[i + 1] = bytes[byteIndex++];
      if (byteIndex < bytes.length) imageData[i + 2] = bytes[byteIndex++];
    }
  }

  static _readBytesDirectly(pixelData, startOffset, length) {
    const bytes = new Uint8Array(length);
    for (let i = 0; i < length; i++) {
      const dataBytePosition = startOffset + i;
      const pixel = Math.floor(dataBytePosition / 3);
      const channel = dataBytePosition % 3;
      bytes[i] = pixelData[pixel * 4 + channel];
    }
    return bytes;
  }

  // Data I/O: LSB (Subtle Mode)
  static _writeBitsToImageData(imageData, bytes) {
    let bitIndex = 0;
    for (const byte of bytes) {
      for (let i = 0; i < 8; i++) {
        const bit = (byte >> (7 - i)) & 1;
        const channelIndex = bitIndex * 4 + (bitIndex % 3);
        imageData[channelIndex] = (imageData[channelIndex] & 0xFE) | bit;
        bitIndex++;
      }
    }
  }

  static _readBitsFromPixelData(pixelData, startOffset, length) {
    const bytes = new Uint8Array(length);
    let bitIndex = startOffset * 8;
    for (let i = 0; i < length; i++) {
      let currentByte = 0;
      for (let j = 0; j < 8; j++) {
        const channelIndex = bitIndex * 4 + (bitIndex % 3);
        const bit = pixelData[channelIndex] & 1;
        currentByte = (currentByte << 1) | bit;
        bitIndex++;
      }
      bytes[i] = currentByte;
    }
    return bytes;
  }

  // Crypto & File Helpers
  static async _readFileAsArrayBuffer(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsArrayBuffer(file);
    });
  }

  static async _loadImage(imageFile) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Failed to load image file.'));
      img.src = URL.createObjectURL(imageFile);
    });
  }

  static async _computeSHA256(data) {
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return new Uint8Array(hashBuffer);
  }

  static async _encryptData(data, password) {
    const key = await this._deriveKey(password);
    const iv = crypto.getRandomValues(new Uint8Array(16));
    const encrypted = await crypto.subtle.encrypt({ name: 'AES-CBC', iv }, key, data);
    const result = new Uint8Array(iv.length + encrypted.byteLength);
    result.set(iv, 0);
    result.set(new Uint8Array(encrypted), iv.length);
    return result;
  }

  static async _decryptData(data, password) {
    const key = await this._deriveKey(password);
    const iv = data.slice(0, 16);
    const encryptedData = data.slice(16);
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-CBC', iv }, key, encryptedData);
    return new Uint8Array(decrypted);
  }

  static async _deriveKey(password) {
    const keyMaterial = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: new Uint8Array(16), iterations: 10000, hash: 'SHA-256' },
      keyMaterial,
      { name: 'AES-CBC', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  static _arraysEqual(a, b) {
    if (a.length !== b.length) return false;
    return a.every((val, index) => val === b[index]);
  }
}

export default ClientImageProcessor;