/**
 * ImageStore - IndexedDB-based image storage for Kid Tasker
 * Manages archival of scanned/photographed worksheet images
 */

const ImageStore = (() => {
  const DB_NAME = 'kidtasker-images';
  const STORE_NAME = 'scans';
  const DB_VERSION = 1;

  let db = null;
  let isAvailable = true;

  /**
   * Opens or creates the IndexedDB database
   * @returns {Promise<void>}
   */
  async function init() {
    if (db !== null) {
      return; // Already initialized
    }

    // Check if IndexedDB is available
    if (!window.indexedDB) {
      console.warn('ImageStore: IndexedDB not available (possibly Safari private browsing)');
      isAvailable = false;
      return;
    }

    return new Promise((resolve, reject) => {
      const request = window.indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => {
        console.warn('ImageStore: Failed to open database', request.error);
        isAvailable = false;
        reject(request.error);
      };

      request.onsuccess = () => {
        db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const database = event.target.result;

        // Create the scans object store if it doesn't exist
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          const store = database.createObjectStore(STORE_NAME, { keyPath: 'worksheetId' });
          // Create index for querying by capturedAt timestamp
          store.createIndex('capturedAt', 'metadata.capturedAt', { unique: false });
        }
      };
    });
  }

  /**
   * Saves an image blob with metadata
   * @param {string} worksheetId - Unique identifier for the worksheet
   * @param {Blob} imageBlob - The image data as a Blob
   * @param {Object} metadata - Image metadata
   * @param {string} metadata.captureMethod - 'flatbed' or 'photo'
   * @param {string} metadata.capturedAt - ISO 8601 timestamp
   * @param {string} metadata.capturedBy - User display name
   * @param {number} metadata.rotation - Rotation in degrees
   * @param {string} metadata.originalFilename - Original file name
   * @param {string} metadata.mimeType - MIME type (e.g., 'image/jpeg')
   * @param {number} metadata.fileSize - File size in bytes
   * @returns {Promise<boolean>} True if saved successfully, false otherwise
   */
  async function saveImage(worksheetId, imageBlob, metadata) {
    if (!isAvailable || db === null) {
      console.warn('ImageStore: Database not available, cannot save image');
      return false;
    }

    try {
      const record = {
        worksheetId,
        imageBlob,
        metadata: {
          captureMethod: metadata.captureMethod || 'photo',
          capturedAt: metadata.capturedAt || new Date().toISOString(),
          capturedBy: metadata.capturedBy || 'Unknown',
          rotation: metadata.rotation || 0,
          originalFilename: metadata.originalFilename || 'image',
          mimeType: metadata.mimeType || 'image/jpeg',
          fileSize: metadata.fileSize || imageBlob.size,
          savedAt: new Date().toISOString()
        }
      };

      return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.put(record);

        request.onerror = () => {
          console.error('ImageStore: Error saving image', request.error);
          reject(request.error);
        };

        request.onsuccess = () => {
          console.log(`ImageStore: Image saved for worksheetId ${worksheetId}`);
          resolve(true);
        };
      });
    } catch (error) {
      console.error('ImageStore: Exception while saving image', error);
      return false;
    }
  }

  /**
   * Retrieves an image and its metadata
   * @param {string} worksheetId - Worksheet identifier
   * @returns {Promise<Object|null>} Object with imageBlob and metadata, or null if not found
   */
  async function getImage(worksheetId) {
    if (!isAvailable || db === null) {
      console.warn('ImageStore: Database not available, cannot retrieve image');
      return null;
    }

    try {
      return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.get(worksheetId);

        request.onerror = () => {
          console.error('ImageStore: Error retrieving image', request.error);
          reject(request.error);
        };

        request.onsuccess = () => {
          const record = request.result;
          if (record) {
            resolve({
              imageBlob: record.imageBlob,
              metadata: record.metadata
            });
          } else {
            resolve(null);
          }
        };
      });
    } catch (error) {
      console.error('ImageStore: Exception while retrieving image', error);
      return null;
    }
  }

  /**
   * Converts an image to a data URL for preview/display
   * @param {string} worksheetId - Worksheet identifier
   * @returns {Promise<string|null>} Data URL string, or null if not found
   */
  async function getImageAsDataUrl(worksheetId) {
    if (!isAvailable || db === null) {
      console.warn('ImageStore: Database not available, cannot convert to data URL');
      return null;
    }

    try {
      const imageData = await getImage(worksheetId);
      if (!imageData || !imageData.imageBlob) {
        return null;
      }

      return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onerror = () => {
          console.error('ImageStore: Error reading blob as data URL', reader.error);
          reject(reader.error);
        };

        reader.onload = () => {
          resolve(reader.result);
        };

        reader.readAsDataURL(imageData.imageBlob);
      });
    } catch (error) {
      console.error('ImageStore: Exception while converting to data URL', error);
      return null;
    }
  }

  /**
   * Deletes an image from storage
   * @param {string} worksheetId - Worksheet identifier
   * @returns {Promise<boolean>} True if deleted successfully, false otherwise
   */
  async function deleteImage(worksheetId) {
    if (!isAvailable || db === null) {
      console.warn('ImageStore: Database not available, cannot delete image');
      return false;
    }

    try {
      return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.delete(worksheetId);

        request.onerror = () => {
          console.error('ImageStore: Error deleting image', request.error);
          reject(request.error);
        };

        request.onsuccess = () => {
          console.log(`ImageStore: Image deleted for worksheetId ${worksheetId}`);
          resolve(true);
        };
      });
    } catch (error) {
      console.error('ImageStore: Exception while deleting image', error);
      return false;
    }
  }

  /**
   * Lists all stored images (metadata only, no blob data)
   * @returns {Promise<Array>} Array of metadata objects
   */
  async function listImages() {
    if (!isAvailable || db === null) {
      console.warn('ImageStore: Database not available, returning empty list');
      return [];
    }

    try {
      return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.getAll();

        request.onerror = () => {
          console.error('ImageStore: Error listing images', request.error);
          reject(request.error);
        };

        request.onsuccess = () => {
          const records = request.result;
          // Return only metadata, excluding blob data
          const metadataList = records.map((record) => ({
            worksheetId: record.worksheetId,
            metadata: record.metadata
          }));
          resolve(metadataList);
        };
      });
    } catch (error) {
      console.error('ImageStore: Exception while listing images', error);
      return [];
    }
  }

  // Public API
  return {
    init,
    saveImage,
    getImage,
    getImageAsDataUrl,
    deleteImage,
    listImages
  };
})();
