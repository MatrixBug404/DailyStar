export const STORAGE_SERVICE = 'STORAGE_SERVICE';

export interface StorageService {
  /**
   * Upload a binary object to storage.
   * @param key       Fully-formed object key (e.g. media/{userId}/{uuid}.jpg)
   * @param buffer    File bytes — already validated, in memory
   * @param mimeType  Server-validated MIME type (from magic-byte detection)
   * @param sizeBytes File size in bytes
   */
  uploadObject(key: string, buffer: Buffer, mimeType: string, sizeBytes: number): Promise<void>;

  /** Delete an object from storage by key. */
  deleteObject(key: string): Promise<void>;

  /**
   * Generate a time-limited signed URL for a GET request.
   *
   * The URL enforces both ResponseContentType and ResponseContentDisposition
   * via S3 response-override query parameters, ensuring:
   * - The browser uses the server-validated MIME type (prevents sniffing)
   * - The file renders inline (not downloaded), filename uses only the UUID segment
   *
   * @param key              Object key
   * @param mimeType         Validated MIME type of the stored object
   * @param expiresInSeconds Signed URL lifetime in seconds
   */
  generateSignedDownloadUrl(
    key: string,
    mimeType: string,
    expiresInSeconds: number,
  ): Promise<string>;

  /**
   * Check whether an object exists in storage.
   * Returns false ONLY for genuine not-found (NoSuchKey / 404) responses.
   * Authentication, permission, network, and server errors are re-thrown.
   */
  objectExists(key: string): Promise<boolean>;
}
