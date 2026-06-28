const cloudinary = require('cloudinary').v2;
const multer = require('multer');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || '',
  api_key: process.env.CLOUDINARY_API_KEY || '',
  api_secret: process.env.CLOUDINARY_API_SECRET || '',
  secure: true,
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

const uploadToCloudinary = (buffer, folder, resourceType = 'auto') => {
  if (!process.env.CLOUDINARY_CLOUD_NAME || process.env.CLOUDINARY_CLOUD_NAME === 'placeholder' || process.env.CLOUDINARY_CLOUD_NAME === '') {
    console.warn('Cloudinary not configured');
    return Promise.resolve({ secure_url: '', public_id: '' });
  }
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: resourceType,
        timeout: 60000,
        // For PDFs and docs - preserve original format
        format: resourceType === 'raw' ? undefined : undefined,
        flags: resourceType === 'raw' ? 'attachment' : undefined,
      },
      (err, result) => err ? reject(new Error(err.message)) : resolve(result)
    );
    stream.write(buffer);
    stream.end();
  });
};

// Map material type -> real file extension
const extFor = (type) => ({ pdf: 'pdf', word: 'docx', pptx: 'pptx' }[type] || null);

// Force the delivery URL to carry the correct extension so Cloudinary
// sends the right Content-Type. ONLY safe for /image/upload/ delivery URLs —
// appending an extension to a /raw/upload/ URL changes the asset reference
// and 404s, since raw public_ids don't carry an extension suffix.
const ensureExt = (url, type) => {
  if (!url) return url;
  if (!url.includes('/image/upload/')) return url; // raw/video — leave untouched
  const ext = extFor(type);
  if (!ext) return url;
  if (url.toLowerCase().endsWith('.' + ext)) return url;
  return url + '.' + ext;
};

// Get a proper viewable URL for files - browsers render PDFs natively, no third-party viewer needed
const getViewUrl = (url, type) => {
  if (!url) return '';
  return ensureExt(url, type);
};

// Get download URL - for raw files just use direct URL, browser handles download
const getDownloadUrl = (url, filename, type) => {
  if (!url) return '';
  // For raw uploads never modify the URL - it will 404
  if (url.includes('/raw/upload/')) return url;
  // For image uploads can add fl_attachment
  if (url.includes('/image/upload/') && !url.includes('fl_attachment')) {
    return url.replace('/image/upload/', '/image/upload/fl_attachment/');
  }
  return url;
};

module.exports = { upload, uploadToCloudinary, cloudinary, getViewUrl, getDownloadUrl };
