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

// Get a proper viewable URL for files - browsers render PDFs natively, no third-party viewer needed
const getViewUrl = (url, type) => {
  if (!url) return '';
  return url;
};

// Get download URL - force download via fl_attachment for both image-stored PDFs and raw files
const getDownloadUrl = (url, filename, type) => {
  if (!url) return '';
  if (url.includes('cloudinary.com') && url.includes('/upload/') && !url.includes('fl_attachment')) {
    return url.replace('/upload/', '/upload/fl_attachment/');
  }
  return url;
};

module.exports = { upload, uploadToCloudinary, cloudinary, getViewUrl, getDownloadUrl };
